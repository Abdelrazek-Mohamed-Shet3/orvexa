from __future__ import annotations

from enum import Enum
from typing import Any, Literal
from pydantic import BaseModel, Field


class MatchingOutcome(str, Enum):
    CLEAR_MATCH = "clear_match"
    POSSIBLE_MATCH = "possible_match"
    MULTIPLE_MATCHES = "multiple_matches"
    NO_MATCH = "no_match"
    CONFLICTING = "conflicting"


class ValidationStatus(str, Enum):
    PASSED = "passed"
    WARNING = "warning"
    FAILED = "failed"
    REQUIRES_HUMAN_REVIEW = "requires_human_review"
    NOT_APPLICABLE = "not_applicable"


class PackagingTier(BaseModel):
    unit_code: str
    unit_label_ar: str
    base_multiplier: int = Field(ge=1)
    is_orderable: bool = True


class CatalogProduct(BaseModel):
    id: str
    sku: str
    name_ar: str
    name_en: str
    brand: str | None = None
    base_unit: str
    standard_price: float | None = None
    moq_base_units: int = Field(default=1, ge=1)
    allow_broken_pack: bool = False
    is_available: bool = True
    packaging_levels: list[PackagingTier] = Field(default_factory=list)
    aliases: list[str] = Field(default_factory=list)
    customer_aliases: dict[str, list[str]] = Field(default_factory=dict)


class CustomerProfile(BaseModel):
    id: str
    company_name: str
    is_active: bool = True
    has_delivery_address: bool = True
    priority_weight: float = Field(default=1.0, gt=0)
    historical_sku_counts: dict[str, int] = Field(default_factory=dict)


class ExtractedOrderLine(BaseModel):
    line_number: int
    raw_description: str
    normalized_description: str
    source_span_start: int
    source_span_end: int
    extracted_quantity: float | None = None
    extracted_unit: str | None = None
    explicit_sku: str | None = None
    extraction_ambiguities: list[str] = Field(default_factory=list)


class ExtractionEnvelope(BaseModel):
    lines: list[ExtractedOrderLine]
    detected_customer_hint: str | None = None
    header_notes: list[str] = Field(default_factory=list)


class PackagingPlanItem(BaseModel):
    unit_code: str
    unit_label_ar: str
    count: int
    base_units_subtotal: int


class PackagingSolution(BaseModel):
    requested_base_units: float
    allocated_base_units: int
    surplus_base_units: float
    deficit_base_units: float
    is_exact: bool
    meets_moq: bool
    plan: list[PackagingPlanItem]
    explanation: str
    explanation_ar: str = ""


class CandidateMatchOption(BaseModel):
    product_id: str
    sku: str
    name_ar: str
    name_en: str
    mismatch_cost: float
    reasons: list[str]


class MatchedOrderLine(BaseModel):
    line_number: int
    extracted: ExtractedOrderLine
    matching_outcome: MatchingOutcome
    assigned_product_id: str | None = None
    assigned_sku: str | None = None
    assigned_name_ar: str | None = None
    assigned_name_en: str | None = None
    unit_price_base: float | None = None
    line_subtotal: float | None = None
    mismatch_cost: float | None = None
    alternatives: list[CandidateMatchOption] = Field(default_factory=list)
    packaging_solution: PackagingSolution | None = None
    requires_human_confirmation: bool = True
    is_human_confirmed: bool = False


class ValidationRuleResult(BaseModel):
    rule_code: str
    status: ValidationStatus
    is_in_mus: bool = False
    message: str
    message_ar: str = ""
    suggested_repair: str | None = None
    suggested_repair_ar: str | None = None


class ProcessOrderRequest(BaseModel):
    organization_id: str
    raw_text: str
    customer: CustomerProfile | None = None
    catalog: list[CatalogProduct]
    require_delivery_address: bool = True
    conformal_clear_threshold: float = Field(default=0.22, ge=0.0, le=1.0)
    conformal_possible_threshold: float = Field(default=0.55, ge=0.0, le=1.0)
    allow_duplicate_skus: bool = False


class RevalidateLineEdit(BaseModel):
    line_number: int
    confirmed_product_id: str | None = None
    confirmed_quantity: float | None = None
    confirmed_unit: str | None = None
    is_human_confirmed: bool = False


class RevalidateOrderRequest(BaseModel):
    organization_id: str
    raw_text: str
    customer: CustomerProfile | None = None
    catalog: list[CatalogProduct]
    current_lines: list[MatchedOrderLine]
    edits: list[RevalidateLineEdit] = Field(default_factory=list)
    require_delivery_address: bool = True
    detected_customer_hint: str | None = None
    header_notes: list[str] = Field(default_factory=list)


class ProcessOrderResponse(BaseModel):
    model_disclaimer: str = (
        "Candidate order prepared by AI extraction and OR mathematical optimization. "
        "Requires explicit authorized human approval."
    )
    overall_feasible: bool
    recommended_status: Literal["needs_review", "needs_clarification"]
    detected_customer_hint: str | None = None
    header_notes: list[str] = Field(default_factory=list)
    estimated_order_total: float | None = None
    currency: str = "EGP"
    lines: list[MatchedOrderLine]
    validation_results: list[ValidationRuleResult]
    mus_conflicts: list[str]
    or_solver_metadata: dict[str, Any]


class ReviewOrderJob(BaseModel):
    order_id: str
    arrival_minute: int = Field(ge=0)
    priority_weight: float = Field(gt=0)
    uncertain_lines: int = Field(ge=0)
    validation_warnings: int = Field(ge=0)
    sla_deadline_minute: int = Field(gt=0)


class ReviewerCapacity(BaseModel):
    reviewer_id: str
    reviewer_name: str
    available_from_minute: int = Field(default=0, ge=0)
    speed_multiplier: float = Field(default=1.0, gt=0)


class ScheduleReviewsRequest(BaseModel):
    orders: list[ReviewOrderJob]
    reviewers: list[ReviewerCapacity]
    arrival_rate_per_hour: float = Field(default=12.0, gt=0)
    mean_service_minutes: float = Field(default=8.0, gt=0)


class ScheduledAssignment(BaseModel):
    order_id: str
    reviewer_id: str
    start_minute: int
    end_minute: int
    tardiness_minutes: int


class QueueingDiagnostics(BaseModel):
    arrival_rate_per_hour: float
    total_service_capacity_per_hour: float
    utilization_rho: float
    is_stable: bool
    littles_law_wip: float | None = None
    erlang_c_wait_probability: float | None = None
    expected_queue_wait_minutes: float | None = None
    bottleneck_alert: str | None = None


class ScheduleReviewsResponse(BaseModel):
    solver_status: str
    objective_value: float
    makespan_minutes: int
    total_weighted_tardiness: float
    assignments: list[ScheduledAssignment]
    queueing_diagnostics: QueueingDiagnostics


class ConformalCalibrateRequest(BaseModel):
    calibration_scores: list[float] = Field(min_length=1)
    calibration_is_error: list[bool] = Field(min_length=1)
    alpha: float = Field(default=0.05, gt=0.0, lt=1.0)


class ConformalCalibrateResponse(BaseModel):
    threshold_tau: float
    alpha_target: float
    empirical_error_below_tau: float
    coverage_guarantee: float
    human_review_fraction: float


class SkuDemandStats(BaseModel):
    sku: str
    daily_demand_mean: float = Field(ge=0)
    daily_demand_std: float = Field(ge=0)
    lead_time_days: float = Field(gt=0)
    unit_cost_egp: float = Field(gt=0)
    unit_margin_egp: float = Field(ge=0)
    holding_cost_per_unit_year: float = Field(gt=0)
    order_setup_cost_egp: float = Field(gt=0)
    service_level_z: float = Field(default=1.65, gt=0)
    current_stock_units: float = Field(default=0, ge=0)
    horizon_demand_units: float = Field(ge=0)


class PlantResourceCapacity(BaseModel):
    resource_id: str
    resource_name_ar: str
    available_hours: float = Field(gt=0)
    hours_per_unit_by_sku: dict[str, float] = Field(default_factory=dict)


class AnalyzeCompanyRequest(BaseModel):
    organization_id: str
    organization_name: str
    catalog: list[CatalogProduct]
    sku_demand_stats: list[SkuDemandStats]
    resources: list[PlantResourceCapacity] = Field(default_factory=list)
    historical_po_texts: list[str] = Field(default_factory=list)
    working_capital_budget_egp: float | None = Field(default=None, gt=0)


class SkuInventoryPolicyResult(BaseModel):
    sku: str
    name_ar: str
    abc_class: Literal["A", "B", "C"]
    xyz_class: Literal["X", "Y", "Z"]
    annual_revenue_egp: float
    safety_stock_units: float
    reorder_point_s: float
    eoq_units: float
    current_stock_units: float
    recommended_replenish_units: float
    stockout_risk_flag: bool


class ResourceBottleneckResult(BaseModel):
    resource_id: str
    resource_name_ar: str
    available_hours: float
    used_hours: float
    slack_hours: float
    utilization_pct: float
    is_bottleneck: bool
    shadow_price_egp_per_hour: float


class CapacityPlanSkuResult(BaseModel):
    sku: str
    horizon_demand_units: float
    optimal_fulfill_units: float
    fulfillment_pct: float
    margin_contribution_egp: float


class HistoricalPoAuditSummary(BaseModel):
    orders_analyzed: int
    total_lines_extracted: int
    matched_lines: int
    exact_packaging_lines: int
    packaging_rounding_delta_units: float


class MultiPeriodLotPlan(BaseModel):
    period_week: int
    sku: str
    demand_units: float
    produce_units: float
    setup_triggered: bool
    ending_inventory_units: float


class BottleneckWhatIf(BaseModel):
    resource_id: str
    resource_name_ar: str
    added_hours: float
    margin_gain_egp: float
    new_total_margin_egp: float


class AnalyzeCompanyResponse(BaseModel):
    organization_name: str
    solver_backend: str
    solve_time_ms: float
    optimal_total_margin_egp: float
    total_working_capital_required_egp: float
    sku_policies: list[SkuInventoryPolicyResult]
    resource_bottlenecks: list[ResourceBottleneckResult]
    capacity_plan: list[CapacityPlanSkuResult]
    multi_period_clsp: list[MultiPeriodLotPlan] = Field(default_factory=list)
    clsp_total_net_profit_egp: float = 0.0
    what_if_expansions: list[BottleneckWhatIf] = Field(default_factory=list)
    po_audit: HistoricalPoAuditSummary


class CtpCheckRequest(BaseModel):
    sku_demands: dict[str, float]
    sku_demand_stats: list[SkuDemandStats]
    resources: list[PlantResourceCapacity]


class CtpSkuAllocation(BaseModel):
    sku: str
    requested_units: float
    from_stock_units: float
    to_produce_units: float
    unmet_shortage_units: float


class CtpCheckResponse(BaseModel):
    feasible_within_standard_capacity: bool
    feasible_with_overtime: bool
    total_overtime_hours_needed: float
    overtime_by_resource_ar: dict[str, float]
    estimated_lead_days: int
    allocations: list[CtpSkuAllocation]
