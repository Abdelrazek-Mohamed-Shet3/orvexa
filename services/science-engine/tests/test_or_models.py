from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.or_models.conformal_calibration import calibrate_conformal_threshold
from app.or_models.global_matching import solve_global_bipartite_matching
from app.or_models.packaging_solver import solve_packaging_decomposition
from app.or_models.review_scheduler import solve_review_schedule
from app.or_models.validation_mus import validate_order_with_mus
from app.ai_pipeline.extractor import extract_candidate_lines
from app.schemas import (
    CatalogProduct,
    CustomerProfile,
    MatchingOutcome,
    PackagingTier,
    ReviewOrderJob,
    ReviewerCapacity,
)


def _sample_catalog() -> list[CatalogProduct]:
    return [
        CatalogProduct(
            id="prod-1",
            sku="OIL-CRY-1L",
            name_ar="زيت كريستال ذرة 1 لتر",
            name_en="Crystal Corn Oil 1L",
            base_unit="bottle",
            standard_price=95.0,
            moq_base_units=12,
            allow_broken_pack=False,
            packaging_levels=[
                PackagingTier(unit_code="carton", unit_label_ar="كرتونة", base_multiplier=12),
                PackagingTier(unit_code="bottle", unit_label_ar="زجاجة", base_multiplier=1),
            ],
            aliases=["كريستال ذرة لتر", "crystal 1L"],
        ),
        CatalogProduct(
            id="prod-2",
            sku="TEA-LIP-250",
            name_ar="شاي ليبتون ناعم 250 جرام",
            name_en="Lipton Black Tea 250g",
            base_unit="pack",
            standard_price=68.0,
            moq_base_units=12,
            allow_broken_pack=False,
            packaging_levels=[
                PackagingTier(unit_code="carton", unit_label_ar="كرتونة", base_multiplier=24),
                PackagingTier(unit_code="pack", unit_label_ar="باكت", base_multiplier=1),
            ],
            aliases=["ليبتون ربع كيلو", "lipton 250g"],
        ),
        CatalogProduct(
            id="prod-3",
            sku="PAS-MLK-400",
            name_ar="مكرونة الملكة قلم 400 جرام",
            name_en="El Maleka Penne Pasta 400g",
            base_unit="pack",
            standard_price=16.5,
            moq_base_units=20,
            allow_broken_pack=True,
            packaging_levels=[
                PackagingTier(unit_code="sack", unit_label_ar="شكارة", base_multiplier=20),
                PackagingTier(unit_code="pack", unit_label_ar="كيس", base_multiplier=1),
            ],
            aliases=["ملكه قلم 400", "مكرونة ملكة قلم"],
        ),
    ]


def test_arabic_english_extraction_and_provenance() -> None:
    raw = "السلام عليكم\n٥ كرتونة كريستال ذرة لتر\n20 كيس مكرونة ملكة قلم"
    lines = extract_candidate_lines(raw)
    assert len(lines) == 2
    assert lines[0].extracted_quantity == 5.0
    assert lines[0].extracted_unit == "carton"
    assert raw[lines[0].source_span_start : lines[0].source_span_end].strip() == "٥ كرتونة كريستال ذرة لتر"
    assert lines[1].extracted_quantity == 20.0
    assert lines[1].extracted_unit == "pack"


def test_global_bipartite_matching_prevents_duplicates() -> None:
    catalog = _sample_catalog()
    raw = "3 كرتونة ليبتون ربع كيلو\n2 كرتونة شاي ليبتون ناعم 250 جرام"
    lines = extract_candidate_lines(raw)
    matches = solve_global_bipartite_matching(lines, catalog, customer=None, allow_duplicate_skus=False)

    assigned_skus = [
        m["product"].sku for m in matches.values() if m["product"] is not None
    ]
    assert len(assigned_skus) == len(set(assigned_skus)), "MILP must not assign duplicate SKU when disallowed"


def test_packaging_milp_exact_and_sealed_rounding() -> None:
    tea = _sample_catalog()[1]  # carton=24, pack=1, allow_broken_pack=False, MOQ=12
    # Exact 2 cartons = 48 packs
    exact_sol = solve_packaging_decomposition(tea, 48, "pack")
    assert exact_sol.is_exact is True
    assert exact_sol.allocated_base_units == 48
    assert exact_sol.plan[0].unit_code == "carton"
    assert exact_sol.plan[0].count == 2

    # Requested 50 packs -> cannot break sealed 24-pack carton -> closest is 2 cartons (48)
    approx_sol = solve_packaging_decomposition(tea, 50, "pack")
    assert approx_sol.is_exact is False
    assert approx_sol.allocated_base_units == 48
    assert approx_sol.deficit_base_units == 2.0


def test_cpsat_mus_identifies_minimal_conflicts() -> None:
    catalog = _sample_catalog()
    raw = "5 كرتونة صنف غير موجود اطلاقا"
    lines = extract_candidate_lines(raw)
    matches = solve_global_bipartite_matching(lines, catalog, customer=None)
    assert matches[1]["outcome"] == MatchingOutcome.NO_MATCH

    client = TestClient(app)
    resp = client.post(
        "/v1/orders/process",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "raw_text": raw,
            "customer": None,
            "catalog": [p.model_dump() for p in catalog],
            "require_delivery_address": True,
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["overall_feasible"] is False
    assert body["recommended_status"] == "needs_clarification"
    # By definition of Minimal Unsatisfiable Subset (MUS), a single violated hard constraint is an irreducible core
    assert len(body["mus_conflicts"]) == 1
    assert body["mus_conflicts"][0] in {"CUSTOMER_IDENTIFIED", "LINE_1_PRODUCT_MATCHED"}
    failed_codes = {r["rule_code"] for r in body["validation_results"] if r["status"] == "failed"}
    assert {"CUSTOMER_IDENTIFIED", "LINE_1_PRODUCT_MATCHED"}.issubset(failed_codes)


def test_conformal_risk_control_guarantee() -> None:
    scores = [0.02, 0.05, 0.08, 0.12, 0.15, 0.19, 0.25, 0.35, 0.45, 0.60, 0.72, 0.85]
    errors = [False, False, False, False, False, False, False, True, False, True, True, True]
    res = calibrate_conformal_threshold(scores, errors, alpha=0.20)
    # At tau=0.45, m=9 and k=1 -> (k+1)/(m+1) = 2/10 = 0.20 <= alpha
    assert 0.0 < res.threshold_tau <= 0.45
    assert res.empirical_error_below_tau <= 0.20


def test_cp_sat_review_scheduler_and_queueing() -> None:
    orders = [
        ReviewOrderJob(order_id="ORD-1", arrival_minute=0, priority_weight=3.0, uncertain_lines=1, validation_warnings=0, sla_deadline_minute=10),
        ReviewOrderJob(order_id="ORD-2", arrival_minute=0, priority_weight=1.0, uncertain_lines=3, validation_warnings=2, sla_deadline_minute=25),
        ReviewOrderJob(order_id="ORD-3", arrival_minute=2, priority_weight=2.0, uncertain_lines=1, validation_warnings=1, sla_deadline_minute=15),
    ]
    reviewers = [
        ReviewerCapacity(reviewer_id="REV-A", reviewer_name="كريم", available_from_minute=0, speed_multiplier=1.0),
        ReviewerCapacity(reviewer_id="REV-B", reviewer_name="سارة", available_from_minute=0, speed_multiplier=1.2),
    ]
    sched = solve_review_schedule(orders, reviewers, arrival_rate_per_hour=10.0, mean_service_minutes=8.0)
    assert sched.solver_status in ("OPTIMAL", "FEASIBLE")
    assert len(sched.assignments) == 3
    assert sched.queueing_diagnostics.is_stable is True
    assert sched.queueing_diagnostics.utilization_rho < 1.0
    # High-priority ORD-1 with tight SLA should finish on time (0 tardiness)
    ord1 = next(a for a in sched.assignments if a.order_id == "ORD-1")
    assert ord1.tardiness_minutes == 0


def test_preamble_separation_leading_unit_and_revalidate() -> None:
    catalog = _sample_catalog()
    raw = (
        "السلام عليكم\n"
        "عايزين الطلبية دي لمحل الفتح لو سمحت:\n"
        "٥ كرتونة كريستال ذرة لتر\n"
        "50 باكت ليبتون ربع كيلو\n"
        "شكارة مكرونة ملكة قلم 400"
    )
    customer = CustomerProfile(id="cust-1", company_name="أسواق الفتح التجارية", is_active=True, has_delivery_address=True)
    client = TestClient(app)
    resp = client.post(
        "/v1/orders/process",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "raw_text": raw,
            "customer": customer.model_dump(),
            "catalog": [p.model_dump() for p in catalog],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    # Preamble must NOT be turned into a product line
    assert len(body["lines"]) == 3
    assert body["detected_customer_hint"] == "الفتح"
    assert body["overall_feasible"] is True
    assert body["recommended_status"] == "needs_review"

    # Line 3 ("شكارة مكرونة ملكة قلم 400") -> qty=1 sack = 20 base packs, NOT 400!
    line3 = body["lines"][2]
    assert line3["assigned_sku"] == "PAS-MLK-400"
    assert line3["extracted"]["extracted_quantity"] == 1.0
    assert line3["extracted"]["extracted_unit"] == "sack"
    assert line3["packaging_solution"]["allocated_base_units"] == 20
    assert body["estimated_order_total"] is not None

    # Revalidate line 2 after human confirms 2 cartons (48 packs)
    reval = client.post(
        "/v1/orders/revalidate",
        json={
            "organization_id": "11111111-1111-1111-1111-111111111111",
            "raw_text": raw,
            "customer": customer.model_dump(),
            "catalog": [p.model_dump() for p in catalog],
            "current_lines": body["lines"],
            "edits": [
                {
                    "line_number": 2,
                    "confirmed_quantity": 2,
                    "confirmed_unit": "carton",
                    "is_human_confirmed": True,
                }
            ],
            "detected_customer_hint": body["detected_customer_hint"],
            "header_notes": body["header_notes"],
        },
    )
    assert reval.status_code == 200
    rbody = reval.json()
    assert rbody["lines"][1]["packaging_solution"]["is_exact"] is True
    assert rbody["lines"][1]["is_human_confirmed"] is True


def test_enterprise_csv_po_and_industrial_skus() -> None:
    industrial_catalog = [
        CatalogProduct(
            id="ind-1",
            sku="CBL-SWD-3X16-100M",
            name_ar="كابل السويدي نحاس 3×16 مم (100 متر)",
            name_en="El Sewedy Copper Cable 3x16mm 100m",
            base_unit="meter",
            standard_price=245.0,
            moq_base_units=100,
            allow_broken_pack=False,
            packaging_levels=[
                PackagingTier(unit_code="reel", unit_label_ar="بكرة", base_multiplier=100),
                PackagingTier(unit_code="meter", unit_label_ar="متر", base_multiplier=1),
            ],
            aliases=["كابل السويدي 3*16", "elsewedy 3x16"],
        ),
        CatalogProduct(
            id="ind-2",
            sku="ABB-MCB-63A",
            name_ar="قاطع كهربائي ABB 63 أمبير ثلاثي",
            name_en="ABB 3P Circuit Breaker 63A",
            base_unit="unit",
            standard_price=820.0,
            moq_base_units=6,
            allow_broken_pack=False,
            packaging_levels=[
                PackagingTier(unit_code="carton", unit_label_ar="كرتونة", base_multiplier=12),
                PackagingTier(unit_code="unit", unit_label_ar="وحدة", base_multiplier=1),
            ],
            aliases=["قاطع 63 امبير", "abb 63a"],
        ),
    ]
    csv_po = (
        "SKU,Description,Quantity,Unit\n"
        "CBL-SWD-3X16-100M,كابل السويدي نحاس 3x16,3,reel\n"
        "ABB-MCB-63A,قاطع 63 امبير,18,unit\n"
    )
    cust = CustomerProfile(
        id="ent-c1",
        company_name="أوراسكوم للإنشاءات - قطاع الكهروميكانيك",
        is_active=True,
        has_delivery_address=True,
    )
    client = TestClient(app)
    resp = client.post(
        "/v1/orders/process",
        json={
            "organization_id": "org-ind",
            "raw_text": csv_po,
            "customer": cust.model_dump(),
            "catalog": [p.model_dump() for p in industrial_catalog],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["lines"]) == 2
    assert body["lines"][0]["assigned_sku"] == "CBL-SWD-3X16-100M"
    assert body["lines"][0]["packaging_solution"]["allocated_base_units"] == 300
    # 18 units requested when carton=12 and allow_broken_pack=False -> closest valid integer pack = 24 units (2 cartons)
    assert body["lines"][1]["assigned_sku"] == "ABB-MCB-63A"
    assert body["lines"][1]["packaging_solution"]["is_exact"] is False
    assert body["lines"][1]["packaging_solution"]["allocated_base_units"] == 24


def test_enterprise_company_or_diagnostics_shadow_prices_and_eoq() -> None:
    mobica_catalog = [
        CatalogProduct(
            id="mob-1",
            sku="MOB-EXEC-DESK",
            name_ar="مكتب تنفيذي موبيكا 200 سم",
            name_en="Mobica Executive Desk 200cm",
            base_unit="unit",
            standard_price=28000.0,
            moq_base_units=1,
            allow_broken_pack=True,
            packaging_levels=[PackagingTier(unit_code="unit", unit_label_ar="وحدة", base_multiplier=1)],
            aliases=["مكتب تنفيذي 200"],
        ),
        CatalogProduct(
            id="mob-2",
            sku="MOB-ERG-CHAIR",
            name_ar="كرسي إداري طبي شبك موبيكا",
            name_en="Mobica Ergonomic Mesh Chair",
            base_unit="unit",
            standard_price=9500.0,
            moq_base_units=4,
            allow_broken_pack=False,
            packaging_levels=[
                PackagingTier(unit_code="carton", unit_label_ar="كرتونة", base_multiplier=2),
                PackagingTier(unit_code="unit", unit_label_ar="وحدة", base_multiplier=1),
            ],
            aliases=["كرسي شبك طبي"],
        ),
    ]
    client = TestClient(app)
    resp = client.post(
        "/v1/or/analyze-company",
        json={
            "organization_id": "org-mobica",
            "organization_name": "موبيكا للأثاث المكتبي والفندقي (Mobica)",
            "catalog": [p.model_dump() for p in mobica_catalog],
            "sku_demand_stats": [
                {
                    "sku": "MOB-EXEC-DESK",
                    "daily_demand_mean": 4.0,
                    "daily_demand_std": 1.2,
                    "lead_time_days": 9.0,
                    "unit_cost_egp": 19000.0,
                    "unit_margin_egp": 9000.0,
                    "holding_cost_per_unit_year": 1800.0,
                    "order_setup_cost_egp": 4500.0,
                    "service_level_z": 1.65,
                    "current_stock_units": 12.0,
                    "horizon_demand_units": 80.0,
                },
                {
                    "sku": "MOB-ERG-CHAIR",
                    "daily_demand_mean": 12.0,
                    "daily_demand_std": 2.5,
                    "lead_time_days": 4.0,
                    "unit_cost_egp": 6200.0,
                    "unit_margin_egp": 3300.0,
                    "holding_cost_per_unit_year": 600.0,
                    "order_setup_cost_egp": 2500.0,
                    "service_level_z": 1.65,
                    "current_stock_units": 120.0,
                    "horizon_demand_units": 200.0,
                },
            ],
            "resources": [
                {
                    "resource_id": "WOOD-CNC",
                    "resource_name_ar": "خط النجارة والـ CNC",
                    "available_hours": 320.0,
                    "hours_per_unit_by_sku": {"MOB-EXEC-DESK": 5.0, "MOB-ERG-CHAIR": 0.5},
                },
                {
                    "resource_id": "UPHOLSTERY",
                    "resource_name_ar": "قسم التنجيد والتجميع",
                    "available_hours": 500.0,
                    "hours_per_unit_by_sku": {"MOB-EXEC-DESK": 1.0, "MOB-ERG-CHAIR": 1.5},
                },
            ],
            "historical_po_texts": ["5 كرتونة كرسي شبك طبي\n2 وحدة مكتب تنفيذي 200"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["optimal_total_margin_egp"] > 0
    # WOOD-CNC should be binding bottleneck (80*5 + 200*0.5 = 500 > 320) with positive shadow price
    wood = next(r for r in body["resource_bottlenecks"] if r["resource_id"] == "WOOD-CNC")
    assert wood["is_bottleneck"] is True
    assert wood["shadow_price_egp_per_hour"] > 0
    # Non-binding UPHOLSTERY should have 0 shadow price (Complementary Slackness)
    uphol = next(r for r in body["resource_bottlenecks"] if r["resource_id"] == "UPHOLSTERY")
    assert uphol["slack_hours"] > 0
    assert uphol["shadow_price_egp_per_hour"] == 0.0
    # Desk current stock 12 < reorder point -> stockout risk flagged
    desk_pol = next(p for p in body["sku_policies"] if p["sku"] == "MOB-EXEC-DESK")
    assert desk_pol["stockout_risk_flag"] is True
    assert desk_pol["abc_class"] in ("A", "B")
    assert body["po_audit"]["matched_lines"] == 2
    # 4-period CLSP MILP + What-If +20% bottleneck expansion
    assert len(body["multi_period_clsp"]) == 8
    assert body["clsp_total_net_profit_egp"] > 0
    assert len(body["what_if_expansions"]) == 1
    assert body["what_if_expansions"][0]["resource_id"] == "WOOD-CNC"
    assert body["what_if_expansions"][0]["margin_gain_egp"] > 0


def test_ctp_capable_to_promise_and_overtime_calculation() -> None:
    client = TestClient(app)
    resp = client.post(
        "/v1/or/check-ctp",
        json={
            "sku_demands": {"MOB-EXEC-DESK": 40.0},
            "sku_demand_stats": [
                {
                    "sku": "MOB-EXEC-DESK",
                    "daily_demand_mean": 4.0,
                    "daily_demand_std": 1.0,
                    "lead_time_days": 7.0,
                    "unit_cost_egp": 19000.0,
                    "unit_margin_egp": 9000.0,
                    "holding_cost_per_unit_year": 1800.0,
                    "order_setup_cost_egp": 4500.0,
                    "current_stock_units": 10.0,
                    "horizon_demand_units": 40.0,
                }
            ],
            "resources": [
                {
                    "resource_id": "WOOD-CNC",
                    "resource_name_ar": "خط النجارة والـ CNC",
                    "available_hours": 100.0,
                    "hours_per_unit_by_sku": {"MOB-EXEC-DESK": 5.0},
                }
            ],
        },
    )
    assert resp.status_code == 200
    ctp = resp.json()
    # 40 demanded - 10 from stock = 30 to produce -> 30 * 5 hrs = 150 hrs needed vs 100 available -> 50 hrs overtime
    assert ctp["feasible_within_standard_capacity"] is False
    assert ctp["feasible_with_overtime"] is True
    assert ctp["total_overtime_hours_needed"] == 50.0
