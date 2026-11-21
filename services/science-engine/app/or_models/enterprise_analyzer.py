from __future__ import annotations

import math
import time
from ortools.linear_solver import pywraplp

from app.ai_pipeline.extractor import extract_order_envelope
from app.or_models.global_matching import solve_global_bipartite_matching
from app.or_models.packaging_solver import solve_packaging_decomposition
from app.schemas import (
    AnalyzeCompanyRequest,
    AnalyzeCompanyResponse,
    BottleneckWhatIf,
    CapacityPlanSkuResult,
    HistoricalPoAuditSummary,
    MultiPeriodLotPlan,
    PlantResourceCapacity,
    ResourceBottleneckResult,
    SkuDemandStats,
    SkuInventoryPolicyResult,
)


def _solve_capacity_lp_total(
    stats: list[SkuDemandStats],
    resources: list[PlantResourceCapacity],
    budget: float | None,
) -> float:
    solver = pywraplp.Solver.CreateSolver("GLOP")
    if solver is None:
        return 0.0
    x = {st.sku: solver.NumVar(0.0, st.horizon_demand_units, f"x_{st.sku}") for st in stats}
    for res in resources:
        solver.Add(
            sum(res.hours_per_unit_by_sku.get(st.sku, 0.0) * x[st.sku] for st in stats)
            <= res.available_hours
        )
    if budget is not None:
        solver.Add(sum(st.unit_cost_egp * x[st.sku] for st in stats) <= budget)
    obj = solver.Objective()
    for st in stats:
        obj.SetCoefficient(x[st.sku], st.unit_margin_egp)
    obj.SetMaximization()
    solver.Solve()
    return float(obj.Value())


def _solve_multi_period_clsp(
    stats: list[SkuDemandStats],
    resources: list[PlantResourceCapacity],
    periods: int = 4,
) -> tuple[list[MultiPeriodLotPlan], float]:
    """
    Multi-Period Capacitated Lot-Sizing Problem (CLSP MILP via HiGHS):
      max  sum_{j,t} (margin_j * sales_{jt} - setup_j * y_{jt} - hold_week_j * I_{jt})
      s.t. I_{j,t-1} + x_{jt} - sales_{jt} = I_{jt}       (inventory flow conservation)
           sales_{jt} <= D_{jt}
           x_{jt} <= M_j * y_{jt}                         (Big-M setup linking)
           sum_j (a_{rj} * x_{jt}) <= C_r / T             (weekly plant capacity)
    """
    if not stats:
        return [], 0.0

    solver = pywraplp.Solver.CreateSolver("HIGHS") or pywraplp.Solver.CreateSolver("CBC")
    if solver is None:
        return [], 0.0

    # Distribute horizon demand across 4 weeks (with realistic week-3 peak factor)
    weights = [0.22, 0.25, 0.30, 0.23]
    x = {}
    y = {}
    inv = {}
    sales = {}

    for st in stats:
        big_m = max(st.horizon_demand_units, 1.0)
        for t in range(1, periods + 1):
            d_jt = st.horizon_demand_units * weights[t - 1]
            x[(st.sku, t)] = solver.NumVar(0.0, big_m, f"x_{st.sku}_{t}")
            y[(st.sku, t)] = solver.BoolVar(f"y_{st.sku}_{t}")
            inv[(st.sku, t)] = solver.NumVar(0.0, big_m * 2.0, f"I_{st.sku}_{t}")
            sales[(st.sku, t)] = solver.NumVar(0.0, d_jt, f"s_{st.sku}_{t}")

            prev_inv = st.current_stock_units if t == 1 else inv[(st.sku, t - 1)]
            solver.Add(prev_inv + x[(st.sku, t)] - sales[(st.sku, t)] == inv[(st.sku, t)])
            solver.Add(x[(st.sku, t)] <= big_m * y[(st.sku, t)])

    for t in range(1, periods + 1):
        for res in resources:
            weekly_cap = res.available_hours / periods
            solver.Add(
                sum(res.hours_per_unit_by_sku.get(st.sku, 0.0) * x[(st.sku, t)] for st in stats)
                <= weekly_cap
            )

    obj = solver.Objective()
    for st in stats:
        weekly_hold = st.holding_cost_per_unit_year / 52.0
        for t in range(1, periods + 1):
            obj.SetCoefficient(sales[(st.sku, t)], st.unit_margin_egp)
            obj.SetCoefficient(y[(st.sku, t)], -st.order_setup_cost_egp)
            obj.SetCoefficient(inv[(st.sku, t)], -weekly_hold)
    obj.SetMaximization()

    status = solver.Solve()
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        return [], 0.0

    plan: list[MultiPeriodLotPlan] = []
    for t in range(1, periods + 1):
        for st in stats:
            d_jt = round(st.horizon_demand_units * weights[t - 1], 2)
            plan.append(
                MultiPeriodLotPlan(
                    period_week=t,
                    sku=st.sku,
                    demand_units=d_jt,
                    produce_units=round(x[(st.sku, t)].solution_value(), 2),
                    setup_triggered=y[(st.sku, t)].solution_value() > 0.5,
                    ending_inventory_units=round(inv[(st.sku, t)].solution_value(), 2),
                )
            )
    return plan, round(float(obj.Value()), 2)


def analyze_enterprise_operations(req: AnalyzeCompanyRequest) -> AnalyzeCompanyResponse:
    """
    Full Mathematical Operations Research Diagnostic Suite for Enterprise Deployment:
      1. ABC-XYZ Inventory Classification (Pareto Revenue + Coefficient of Variation).
      2. Stochastic (s, S) Safety-Stock, Reorder Point & EOQ Policy.
      3. Multi-Resource Aggregate Capacity & Bottleneck Linear Program (GLOP Simplex)
         with exact Dual / Shadow Prices (pi_r).
      4. Multi-Period Capacitated Lot-Sizing MILP (4-Week CLSP via HiGHS).
      5. Parametric Bottleneck What-If Capacity Expansion (+20% hours).
      6. Batch Historical Purchase Order MILP Matching & Packaging Efficiency Audit.
    """
    t0 = time.perf_counter()
    catalog_by_sku = {p.sku: p for p in req.catalog}

    # 1. ABC-XYZ + EOQ + Safety Stock
    revenues: list[tuple[str, float]] = []
    for st in req.sku_demand_stats:
        prod = catalog_by_sku.get(st.sku)
        unit_price = (
            prod.standard_price
            if prod and prod.standard_price is not None
            else st.unit_cost_egp + st.unit_margin_egp
        )
        annual_rev = st.daily_demand_mean * 365.0 * unit_price
        revenues.append((st.sku, annual_rev))

    revenues.sort(key=lambda item: item[1], reverse=True)
    total_rev = sum(r for _, r in revenues) or 1.0
    abc_map: dict[str, str] = {}
    cum = 0.0
    for sku, rev in revenues:
        prev_share = cum / total_rev
        cum += rev
        if prev_share < 0.80:
            abc_map[sku] = "A"
        elif prev_share < 0.95:
            abc_map[sku] = "B"
        else:
            abc_map[sku] = "C"

    sku_policies: list[SkuInventoryPolicyResult] = []
    total_working_capital = 0.0

    for st in req.sku_demand_stats:
        prod = catalog_by_sku.get(st.sku)
        name_ar = prod.name_ar if prod else st.sku
        annual_demand = st.daily_demand_mean * 365.0
        annual_rev = dict(revenues)[st.sku]

        cv = (st.daily_demand_std / st.daily_demand_mean) if st.daily_demand_mean > 0 else 1.0
        xyz = "X" if cv < 0.25 else ("Y" if cv < 0.60 else "Z")

        safety_stock = st.service_level_z * st.daily_demand_std * math.sqrt(st.lead_time_days)
        reorder_point = st.daily_demand_mean * st.lead_time_days + safety_stock
        eoq = math.sqrt((2.0 * st.order_setup_cost_egp * max(annual_demand, 1e-6)) / st.holding_cost_per_unit_year)

        replenish = 0.0
        stockout_risk = st.current_stock_units <= reorder_point
        if stockout_risk:
            target_level = reorder_point + eoq
            replenish = max(0.0, target_level - st.current_stock_units)
            total_working_capital += replenish * st.unit_cost_egp

        sku_policies.append(
            SkuInventoryPolicyResult(
                sku=st.sku,
                name_ar=name_ar,
                abc_class=abc_map[st.sku],  # type: ignore[arg-type]
                xyz_class=xyz,  # type: ignore[arg-type]
                annual_revenue_egp=round(annual_rev, 2),
                safety_stock_units=round(safety_stock, 2),
                reorder_point_s=round(reorder_point, 2),
                eoq_units=round(eoq, 2),
                current_stock_units=round(st.current_stock_units, 2),
                recommended_replenish_units=round(replenish, 2),
                stockout_risk_flag=stockout_risk,
            )
        )

    # 2. Aggregate Capacity & Bottleneck Linear Program (GLOP Simplex + Duals)
    solver = pywraplp.Solver.CreateSolver("GLOP")
    if solver is None:
        raise RuntimeError("GLOP LP solver unavailable in OR-Tools")

    x_vars = {
        st.sku: solver.NumVar(0.0, st.horizon_demand_units, f"x_{st.sku}")
        for st in req.sku_demand_stats
    }

    resource_constraints = []
    for res in req.resources:
        ct = solver.Constraint(0.0, res.available_hours, f"cap_{res.resource_id}")
        for st in req.sku_demand_stats:
            coeff = res.hours_per_unit_by_sku.get(st.sku, 0.0)
            if coeff > 0:
                ct.SetCoefficient(x_vars[st.sku], coeff)
        resource_constraints.append((res, ct))

    if req.working_capital_budget_egp is not None:
        budget_ct = solver.Constraint(0.0, req.working_capital_budget_egp, "working_capital_budget")
        for st in req.sku_demand_stats:
            budget_ct.SetCoefficient(x_vars[st.sku], st.unit_cost_egp)

    obj = solver.Objective()
    for st in req.sku_demand_stats:
        obj.SetCoefficient(x_vars[st.sku], st.unit_margin_egp)
    obj.SetMaximization()

    lp_status = solver.Solve()
    if lp_status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        raise RuntimeError(f"Capacity LP failed with status {lp_status}")

    base_margin = float(obj.Value())

    capacity_plan: list[CapacityPlanSkuResult] = []
    for st in req.sku_demand_stats:
        opt_val = x_vars[st.sku].solution_value()
        pct = (opt_val / st.horizon_demand_units * 100.0) if st.horizon_demand_units > 0 else 100.0
        capacity_plan.append(
            CapacityPlanSkuResult(
                sku=st.sku,
                horizon_demand_units=round(st.horizon_demand_units, 2),
                optimal_fulfill_units=round(opt_val, 2),
                fulfillment_pct=round(pct, 1),
                margin_contribution_egp=round(opt_val * st.unit_margin_egp, 2),
            )
        )

    resource_bottlenecks: list[ResourceBottleneckResult] = []
    what_if_expansions: list[BottleneckWhatIf] = []

    for res, ct in resource_constraints:
        used = sum(
            res.hours_per_unit_by_sku.get(st.sku, 0.0) * x_vars[st.sku].solution_value()
            for st in req.sku_demand_stats
        )
        slack = max(0.0, res.available_hours - used)
        util_pct = (used / res.available_hours * 100.0) if res.available_hours > 0 else 0.0
        dual = max(0.0, float(ct.dual_value()))
        is_bottleneck = slack <= 1e-4 or dual > 1e-4

        resource_bottlenecks.append(
            ResourceBottleneckResult(
                resource_id=res.resource_id,
                resource_name_ar=res.resource_name_ar,
                available_hours=round(res.available_hours, 2),
                used_hours=round(used, 2),
                slack_hours=round(slack, 2),
                utilization_pct=round(util_pct, 1),
                is_bottleneck=is_bottleneck,
                shadow_price_egp_per_hour=round(dual, 2),
            )
        )

        if is_bottleneck and res.available_hours > 0:
            added_hrs = round(res.available_hours * 0.20, 1)
            expanded_resources = [
                r.model_copy(update={"available_hours": r.available_hours + added_hrs})
                if r.resource_id == res.resource_id
                else r
                for r in req.resources
            ]
            new_margin = _solve_capacity_lp_total(
                req.sku_demand_stats, expanded_resources, req.working_capital_budget_egp
            )
            what_if_expansions.append(
                BottleneckWhatIf(
                    resource_id=res.resource_id,
                    resource_name_ar=res.resource_name_ar,
                    added_hours=added_hrs,
                    margin_gain_egp=round(max(0.0, new_margin - base_margin), 2),
                    new_total_margin_egp=round(new_margin, 2),
                )
            )

    # 3. 4-Week Multi-Period Capacitated Lot-Sizing MILP
    clsp_plan, clsp_net_profit = _solve_multi_period_clsp(req.sku_demand_stats, req.resources, periods=4)

    # 4. Historical PO Batch MILP Matching & Packaging Efficiency Audit
    total_lines = 0
    matched_lines = 0
    exact_pkg_lines = 0
    rounding_delta_units = 0.0

    for po_text in req.historical_po_texts:
        env = extract_order_envelope(po_text)
        total_lines += len(env.lines)
        match_map = solve_global_bipartite_matching(env.lines, req.catalog, customer=None)
        for ln in env.lines:
            prod = match_map[ln.line_number]["product"]
            if prod is not None:
                matched_lines += 1
                if ln.extracted_quantity and ln.extracted_quantity > 0:
                    pkg = solve_packaging_decomposition(prod, ln.extracted_quantity, ln.extracted_unit)
                    if pkg.is_exact:
                        exact_pkg_lines += 1
                    else:
                        rounding_delta_units += abs(pkg.surplus_base_units - pkg.deficit_base_units)

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    return AnalyzeCompanyResponse(
        organization_name=req.organization_name,
        solver_backend="OR-Tools GLOP Simplex + HiGHS MILP (4-Period CLSP)",
        solve_time_ms=elapsed_ms,
        optimal_total_margin_egp=round(base_margin, 2),
        total_working_capital_required_egp=round(total_working_capital, 2),
        sku_policies=sku_policies,
        resource_bottlenecks=resource_bottlenecks,
        capacity_plan=capacity_plan,
        multi_period_clsp=clsp_plan,
        clsp_total_net_profit_egp=clsp_net_profit,
        what_if_expansions=what_if_expansions,
        po_audit=HistoricalPoAuditSummary(
            orders_analyzed=len(req.historical_po_texts),
            total_lines_extracted=total_lines,
            matched_lines=matched_lines,
            exact_packaging_lines=exact_pkg_lines,
            packaging_rounding_delta_units=round(rounding_delta_units, 2),
        ),
    )
