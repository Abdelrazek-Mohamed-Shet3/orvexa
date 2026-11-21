from __future__ import annotations

import time
from fastapi import FastAPI

from app.ai_pipeline.extractor import extract_order_envelope
from app.or_models.conformal_calibration import calibrate_conformal_threshold
from app.or_models.ctp_solver import solve_capable_to_promise
from app.or_models.enterprise_analyzer import analyze_enterprise_operations
from app.or_models.global_matching import solve_global_bipartite_matching
from app.or_models.packaging_solver import solve_packaging_decomposition
from app.or_models.review_scheduler import solve_review_schedule
from app.or_models.validation_mus import validate_order_with_mus
from app.schemas import (
    AnalyzeCompanyRequest,
    AnalyzeCompanyResponse,
    CatalogProduct,
    ConformalCalibrateRequest,
    ConformalCalibrateResponse,
    CtpCheckRequest,
    CtpCheckResponse,
    MatchedOrderLine,
    MatchingOutcome,
    ProcessOrderRequest,
    ProcessOrderResponse,
    RevalidateOrderRequest,
    ScheduleReviewsRequest,
    ScheduleReviewsResponse,
)

app = FastAPI(
    title="ORVEXA Science & Operations Research Engine",
    version="0.2.0",
    description="Hybrid Arabic/English candidate extraction + exact MILP/CP-SAT Operations Research solvers.",
)


def _compute_line_pricing(
    prod: CatalogProduct | None,
    allocated_units: int | None,
) -> tuple[float | None, float | None]:
    if prod is None or prod.standard_price is None:
        return None, None
    unit_p = float(prod.standard_price)
    if allocated_units is None:
        return unit_p, None
    return unit_p, round(unit_p * allocated_units, 2)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "orvexa-science-engine"}


@app.post("/v1/orders/process", response_model=ProcessOrderResponse)
def process_order(req: ProcessOrderRequest) -> ProcessOrderResponse:
    t0 = time.perf_counter()

    # Stage 1: Provenance-preserving candidate extraction (separates header/customer hints from lines)
    envelope = extract_order_envelope(req.raw_text)
    extracted_lines = envelope.lines

    # Stage 2: Global Constrained Bipartite Assignment (MILP)
    match_map = solve_global_bipartite_matching(
        lines=extracted_lines,
        catalog=req.catalog,
        customer=req.customer,
        clear_threshold=req.conformal_clear_threshold,
        possible_threshold=req.conformal_possible_threshold,
        allow_duplicate_skus=req.allow_duplicate_skus,
    )

    # Stage 3: Integer Packaging & Unit Decomposition (MILP) + Catalog Pricing
    matched_lines: list[MatchedOrderLine] = []
    order_total = 0.0
    has_any_price = False

    for line in extracted_lines:
        m_info = match_map[line.line_number]
        prod: CatalogProduct | None = m_info["product"]
        pkg_sol = None
        if prod is not None and line.extracted_quantity is not None and line.extracted_quantity > 0:
            pkg_sol = solve_packaging_decomposition(
                product=prod,
                requested_quantity=line.extracted_quantity,
                requested_unit=line.extracted_unit,
            )

        unit_price, subtotal = _compute_line_pricing(
            prod, pkg_sol.allocated_base_units if pkg_sol else None
        )
        if subtotal is not None:
            order_total += subtotal
            has_any_price = True

        outcome: MatchingOutcome = m_info["outcome"]
        requires_conf = (
            outcome != MatchingOutcome.CLEAR_MATCH
            or len(line.extraction_ambiguities) > 0
            or (pkg_sol is not None and not pkg_sol.is_exact)
        )

        matched_lines.append(
            MatchedOrderLine(
                line_number=line.line_number,
                extracted=line,
                matching_outcome=outcome,
                assigned_product_id=prod.id if prod else None,
                assigned_sku=prod.sku if prod else None,
                assigned_name_ar=prod.name_ar if prod else None,
                assigned_name_en=prod.name_en if prod else None,
                unit_price_base=unit_price,
                line_subtotal=subtotal,
                mismatch_cost=m_info["mismatch_cost"],
                alternatives=m_info["alternatives"],
                packaging_solution=pkg_sol,
                requires_human_confirmation=requires_conf,
                is_human_confirmed=False,
            )
        )

    # Stage 4: CP-SAT Business Rule Validation + MUS Conflict Explanation
    overall_feasible, val_results, mus_conflicts = validate_order_with_mus(
        customer=req.customer,
        lines=matched_lines,
        require_delivery_address=req.require_delivery_address,
    )

    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)
    recommended_status = "needs_review" if overall_feasible else "needs_clarification"

    return ProcessOrderResponse(
        overall_feasible=overall_feasible,
        recommended_status=recommended_status,
        detected_customer_hint=envelope.detected_customer_hint,
        header_notes=envelope.header_notes,
        estimated_order_total=round(order_total, 2) if has_any_price else None,
        lines=matched_lines,
        validation_results=val_results,
        mus_conflicts=mus_conflicts,
        or_solver_metadata={
            "matching_model": "Global Constrained Bipartite Assignment (MILP)",
            "packaging_model": "Integer Packaging Decomposition (MILP)",
            "validation_model": "CP-SAT CSP + Deletion MUS",
            "solve_time_ms": elapsed_ms,
        },
    )


@app.post("/v1/orders/revalidate", response_model=ProcessOrderResponse)
def revalidate_order(req: RevalidateOrderRequest) -> ProcessOrderResponse:
    """
    Re-runs Packaging MILP + CP-SAT Validation + MUS immediately after human edits
    (e.g., selecting an alternative SKU or confirming rounded pack quantity).
    """
    t0 = time.perf_counter()
    catalog_by_id = {p.id: p for p in req.catalog}
    edits_by_line = {e.line_number: e for e in req.edits}

    updated_lines: list[MatchedOrderLine] = []
    order_total = 0.0
    has_any_price = False

    for line in req.current_lines:
        edit = edits_by_line.get(line.line_number)
        updated = line.model_copy(deep=True)

        if edit is not None:
            if edit.confirmed_product_id is not None:
                prod = catalog_by_id.get(edit.confirmed_product_id)
                if prod:
                    updated.assigned_product_id = prod.id
                    updated.assigned_sku = prod.sku
                    updated.assigned_name_ar = prod.name_ar
                    updated.assigned_name_en = prod.name_en
                    updated.matching_outcome = MatchingOutcome.CLEAR_MATCH
                    updated.mismatch_cost = 0.0
            if edit.confirmed_quantity is not None:
                updated.extracted.extracted_quantity = edit.confirmed_quantity
                updated.extracted.extraction_ambiguities = [
                    a for a in updated.extracted.extraction_ambiguities if a not in ("missing_quantity", "implicit_unit_quantity_one")
                ]
            if edit.confirmed_unit is not None:
                updated.extracted.extracted_unit = edit.confirmed_unit
                updated.extracted.extraction_ambiguities = [
                    a for a in updated.extracted.extraction_ambiguities if a != "missing_or_ambiguous_unit"
                ]
            if edit.is_human_confirmed:
                updated.is_human_confirmed = True
                updated.requires_human_confirmation = False

        prod = catalog_by_id.get(updated.assigned_product_id) if updated.assigned_product_id else None
        qty = updated.extracted.extracted_quantity
        if prod is not None and qty is not None and qty > 0:
            updated.packaging_solution = solve_packaging_decomposition(
                product=prod,
                requested_quantity=qty,
                requested_unit=updated.extracted.extracted_unit,
            )

        unit_price, subtotal = _compute_line_pricing(
            prod, updated.packaging_solution.allocated_base_units if updated.packaging_solution else None
        )
        updated.unit_price_base = unit_price
        updated.line_subtotal = subtotal
        if subtotal is not None:
            order_total += subtotal
            has_any_price = True

        updated_lines.append(updated)

    overall_feasible, val_results, mus_conflicts = validate_order_with_mus(
        customer=req.customer,
        lines=updated_lines,
        require_delivery_address=req.require_delivery_address,
    )
    elapsed_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    return ProcessOrderResponse(
        overall_feasible=overall_feasible,
        recommended_status="needs_review" if overall_feasible else "needs_clarification",
        detected_customer_hint=req.detected_customer_hint,
        header_notes=req.header_notes,
        estimated_order_total=round(order_total, 2) if has_any_price else None,
        lines=updated_lines,
        validation_results=val_results,
        mus_conflicts=mus_conflicts,
        or_solver_metadata={
            "matching_model": "Human-Confirmed + MILP Global Matching",
            "packaging_model": "Integer Packaging Decomposition (MILP)",
            "validation_model": "CP-SAT CSP + Deletion MUS",
            "solve_time_ms": elapsed_ms,
        },
    )


@app.post("/v1/or/schedule-reviews", response_model=ScheduleReviewsResponse)
def schedule_reviews(req: ScheduleReviewsRequest) -> ScheduleReviewsResponse:
    return solve_review_schedule(
        orders=req.orders,
        reviewers=req.reviewers,
        arrival_rate_per_hour=req.arrival_rate_per_hour,
        mean_service_minutes=req.mean_service_minutes,
    )


@app.post("/v1/or/calibrate-conformal", response_model=ConformalCalibrateResponse)
def calibrate_conformal(req: ConformalCalibrateRequest) -> ConformalCalibrateResponse:
    return calibrate_conformal_threshold(
        calibration_scores=req.calibration_scores,
        calibration_is_error=req.calibration_is_error,
        alpha=req.alpha,
    )


@app.post("/v1/or/analyze-company", response_model=AnalyzeCompanyResponse)
def analyze_company(req: AnalyzeCompanyRequest) -> AnalyzeCompanyResponse:
    return analyze_enterprise_operations(req)


@app.post("/v1/or/check-ctp", response_model=CtpCheckResponse)
def check_ctp(req: CtpCheckRequest) -> CtpCheckResponse:
    return solve_capable_to_promise(req)
