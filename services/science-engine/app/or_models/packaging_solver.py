from __future__ import annotations

from ortools.linear_solver import pywraplp

from app.schemas import CatalogProduct, PackagingPlanItem, PackagingSolution, PackagingTier


def solve_packaging_decomposition(
    product: CatalogProduct,
    requested_quantity: float,
    requested_unit: str | None,
) -> PackagingSolution:
    """
    Integer Packaging & Unit Decomposition (MILP):
      min  alpha_plus * d_plus + alpha_minus * d_minus + sum_k eps_k * q_k
      s.t. sum_k w_k * q_k - d_plus + d_minus = D_base
           sum_k w_k * q_k >= MOQ
           q_k in Z_{>= 0}, d_plus, d_minus >= 0
    """
    orderable_tiers: list[PackagingTier] = [
        t for t in product.packaging_levels if t.is_orderable
    ]
    if not orderable_tiers:
        orderable_tiers = [
            PackagingTier(
                unit_code=product.base_unit,
                unit_label_ar=product.base_unit,
                base_multiplier=1,
                is_orderable=True,
            )
        ]

    if not product.allow_broken_pack and any(t.base_multiplier > 1 for t in orderable_tiers):
        sealed_tiers = [t for t in orderable_tiers if t.base_multiplier > 1]
    else:
        sealed_tiers = orderable_tiers

    multiplier_for_req = 1
    if requested_unit:
        for t in orderable_tiers:
            if t.unit_code == requested_unit:
                multiplier_for_req = t.base_multiplier
                break
    requested_base_units = requested_quantity * multiplier_for_req

    solver = pywraplp.Solver.CreateSolver("HIGHS") or pywraplp.Solver.CreateSolver("CBC")
    if solver is None:
        raise RuntimeError("No MILP solver backend (HIGHS/CBC) available")

    max_mult = max(t.base_multiplier for t in sealed_tiers)
    upper_bound_total = max(int(requested_base_units) + max_mult + product.moq_base_units, max_mult)

    q = [
        solver.IntVar(0, upper_bound_total, f"q_{t.unit_code}")
        for t in sealed_tiers
    ]
    d_plus = solver.NumVar(0.0, float(upper_bound_total), "d_plus")
    d_minus = solver.NumVar(0.0, float(upper_bound_total), "d_minus")

    allocated_expr = sum(t.base_multiplier * q[k] for k, t in enumerate(sealed_tiers))

    solver.Add(allocated_expr - d_plus + d_minus == requested_base_units)
    solver.Add(allocated_expr >= product.moq_base_units)

    obj = solver.Objective()
    obj.SetCoefficient(d_plus, 1.0)
    obj.SetCoefficient(d_minus, 1.05)
    for k, tier in enumerate(sealed_tiers):
        pack_penalty = 0.001 / max(1, tier.base_multiplier)
        obj.SetCoefficient(q[k], pack_penalty)
    obj.SetMinimization()

    status = solver.Solve()
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        raise RuntimeError(f"Packaging MILP failed with status {status}")

    plan: list[PackagingPlanItem] = []
    allocated_total = 0
    for k, tier in sorted(enumerate(sealed_tiers), key=lambda pair: -pair[1].base_multiplier):
        cnt = int(round(q[k].solution_value()))
        if cnt > 0:
            sub = cnt * tier.base_multiplier
            allocated_total += sub
            plan.append(
                PackagingPlanItem(
                    unit_code=tier.unit_code,
                    unit_label_ar=tier.unit_label_ar,
                    count=cnt,
                    base_units_subtotal=sub,
                )
            )

    surplus = max(0.0, allocated_total - requested_base_units)
    deficit = max(0.0, requested_base_units - allocated_total)
    is_exact = abs(allocated_total - requested_base_units) < 1e-6
    meets_moq = allocated_total >= product.moq_base_units

    if is_exact:
        explanation = "Exact valid packaging decomposition found."
        explanation_ar = "تعبئة متطابقة تماماً مع قواعد التغليف."
    elif allocated_total > requested_base_units and requested_base_units < product.moq_base_units:
        explanation = (
            f"Requested {requested_base_units:g} {product.base_unit} is below MOQ ({product.moq_base_units}); "
            f"minimum valid packaging is {allocated_total} {product.base_unit}."
        )
        explanation_ar = (
            f"الكمية المطلوبة ({requested_base_units:g}) أقل من الحد الأدنى للطلب ({product.moq_base_units})؛ "
            f"أقرب تعبئة صالحة هي {allocated_total} وحدة."
        )
    else:
        explanation = (
            f"Requested {requested_base_units:g} {product.base_unit} cannot be packed without breaking sealed units; "
            f"closest valid integer pack is {allocated_total} {product.base_unit}."
        )
        explanation_ar = (
            f"لا يمكن تجزئة الكرتونة المغلقة للكمية ({requested_base_units:g})؛ "
            f"أقرب حل تعبئة صحيح هو {allocated_total} وحدة."
        )

    return PackagingSolution(
        requested_base_units=requested_base_units,
        allocated_base_units=allocated_total,
        surplus_base_units=surplus,
        deficit_base_units=deficit,
        is_exact=is_exact,
        meets_moq=meets_moq,
        plan=plan,
        explanation=explanation,
        explanation_ar=explanation_ar,
    )
