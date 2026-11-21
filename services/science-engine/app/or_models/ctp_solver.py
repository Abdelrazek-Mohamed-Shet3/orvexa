from __future__ import annotations

from ortools.linear_solver import pywraplp

from app.schemas import CtpCheckRequest, CtpCheckResponse, CtpSkuAllocation


def solve_capable_to_promise(req: CtpCheckRequest) -> CtpCheckResponse:
    """
    Capable-to-Promise (CTP) Linear Program (GLOP / HiGHS):
    Evaluates whether a specific incoming Purchase Order can be fulfilled from existing stock
    plus remaining plant/warehouse capacity within the requested window, or calculates exact
    overtime hours required per bottleneck resource.

      min  sum_r P_ot * ot_r + sum_j P_short * short_j
      s.t. fulfill_j = from_stock_j + produce_j
           fulfill_j + short_j = demand_j
           from_stock_j <= current_stock_j
           sum_j a_{rj} * produce_j <= available_hours_r + ot_r   for all resources r
    """
    solver = pywraplp.Solver.CreateSolver("GLOP")
    if solver is None:
        raise RuntimeError("GLOP LP solver unavailable")

    demands = req.sku_demands
    stock_by_sku = {s.sku: s.current_stock_units for s in req.sku_demand_stats}

    from_stock = {
        sku: solver.NumVar(0.0, min(qty, stock_by_sku.get(sku, 0.0)), f"stk_{sku}")
        for sku, qty in demands.items()
    }
    produce = {
        sku: solver.NumVar(0.0, qty, f"prod_{sku}")
        for sku, qty in demands.items()
    }
    shortage = {
        sku: solver.NumVar(0.0, qty, f"short_{sku}")
        for sku, qty in demands.items()
    }

    for sku, qty in demands.items():
        solver.Add(from_stock[sku] + produce[sku] + shortage[sku] == qty)

    overtime_vars = {}
    for res in req.resources:
        ot = solver.NumVar(0.0, res.available_hours * 2.0, f"ot_{res.resource_id}")
        overtime_vars[res.resource_id] = (res, ot)
        solver.Add(
            sum(res.hours_per_unit_by_sku.get(sku, 0.0) * produce[sku] for sku in demands)
            <= res.available_hours + ot
        )

    obj = solver.Objective()
    for pr_var in produce.values():
        # Prefer consuming available stock before scheduling new production
        obj.SetCoefficient(pr_var, 0.01)
    for ot_res, ot_var in overtime_vars.values():
        obj.SetCoefficient(ot_var, 10.0)
    for short_var in shortage.values():
        obj.SetCoefficient(short_var, 10000.0)
    obj.SetMinimization()

    status = solver.Solve()
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        raise RuntimeError(f"CTP LP failed with status {status}")

    allocations: list[CtpSkuAllocation] = []
    total_shortage = 0.0
    for sku, qty in demands.items():
        fs = from_stock[sku].solution_value()
        pr = produce[sku].solution_value()
        sh = shortage[sku].solution_value()
        total_shortage += sh
        allocations.append(
            CtpSkuAllocation(
                sku=sku,
                requested_units=round(qty, 2),
                from_stock_units=round(fs, 2),
                to_produce_units=round(pr, 2),
                unmet_shortage_units=round(sh, 2),
            )
        )

    ot_needed: dict[str, float] = {}
    total_ot = 0.0
    for rid, (res, ot_var) in overtime_vars.items():
        val = round(ot_var.solution_value(), 2)
        if val > 1e-4:
            ot_needed[res.resource_name_ar] = val
            total_ot += val

    feasible_without_overtime = total_shortage <= 1e-4 and total_ot <= 1e-4
    estimated_days = 1 if (feasible_without_overtime and all(a.to_produce_units <= 1e-4 for a in allocations)) else (
        3 if feasible_without_overtime else 6
    )

    return CtpCheckResponse(
        feasible_within_standard_capacity=feasible_without_overtime,
        feasible_with_overtime=(total_shortage <= 1e-4),
        total_overtime_hours_needed=round(total_ot, 2),
        overtime_by_resource_ar=ot_needed,
        estimated_lead_days=estimated_days,
        allocations=allocations,
    )
