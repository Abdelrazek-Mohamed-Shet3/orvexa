from __future__ import annotations

from dataclasses import dataclass
from ortools.sat.python import cp_model

from app.schemas import (
    CustomerProfile,
    MatchedOrderLine,
    MatchingOutcome,
    ValidationRuleResult,
    ValidationStatus,
)


@dataclass
class _RuleConstraint:
    code: str
    severity: ValidationStatus
    satisfied: bool
    message: str
    message_ar: str
    suggested_repair: str | None
    suggested_repair_ar: str | None


def _is_subset_feasible(rules: list[_RuleConstraint]) -> bool:
    model = cp_model.CpModel()
    order_valid = model.NewBoolVar("order_valid")
    model.Add(order_valid == 1)

    for idx, r in enumerate(rules):
        rule_sat = model.NewBoolVar(f"rule_{idx}_{r.code}")
        model.Add(rule_sat == (1 if r.satisfied else 0))
        model.Add(order_valid <= rule_sat)

    solver = cp_model.CpSolver()
    status = solver.Solve(model)
    return status in (cp_model.OPTIMAL, cp_model.FEASIBLE)


def _extract_mus(hard_rules: list[_RuleConstraint]) -> list[str]:
    if _is_subset_feasible(hard_rules):
        return []

    mus = list(hard_rules)
    for candidate in list(hard_rules):
        reduced = [r for r in mus if r is not candidate]
        if not _is_subset_feasible(reduced):
            mus = reduced
    return [r.code for r in mus]


def validate_order_with_mus(
    customer: CustomerProfile | None,
    lines: list[MatchedOrderLine],
    require_delivery_address: bool = True,
) -> tuple[bool, list[ValidationRuleResult], list[str]]:
    """
    CP-SAT Constraint Satisfaction Business Validator (Spec §8.8) + MUS Explainer.
    """
    rules: list[_RuleConstraint] = []

    if customer is None:
        rules.append(
            _RuleConstraint(
                code="CUSTOMER_IDENTIFIED",
                severity=ValidationStatus.FAILED,
                satisfied=False,
                message="Customer record is not identified for this incoming request.",
                message_ar="لم يتم ربط الطلب بملف عميل مسجل حتى الآن.",
                suggested_repair="Select an existing active customer or create a customer record.",
                suggested_repair_ar="اختر العميل من القائمة أو أنشئ ملف عميل جديد.",
            )
        )
    else:
        rules.append(
            _RuleConstraint(
                code="CUSTOMER_ACTIVE",
                severity=ValidationStatus.FAILED,
                satisfied=customer.is_active,
                message=(
                    f"Customer '{customer.company_name}' is active."
                    if customer.is_active
                    else f"Customer '{customer.company_name}' is marked inactive."
                ),
                message_ar=(
                    f"حساب العميل «{customer.company_name}» نشط ومفعل."
                    if customer.is_active
                    else f"حساب العميل «{customer.company_name}» موقوف حالياً."
                ),
                suggested_repair=None if customer.is_active else "Activate customer or verify commercial eligibility.",
                suggested_repair_ar=None if customer.is_active else "تفعيل حساب العميل أو مراجعة الإدارة.",
            )
        )
        if require_delivery_address:
            rules.append(
                _RuleConstraint(
                    code="DELIVERY_ADDRESS_PRESENT",
                    severity=ValidationStatus.FAILED,
                    satisfied=customer.has_delivery_address,
                    message=(
                        "Customer delivery address is present."
                        if customer.has_delivery_address
                        else "Required delivery address is missing."
                    ),
                    message_ar=(
                        "عنوان التوصيل المسجل للعميل مكتمل."
                        if customer.has_delivery_address
                        else "عنوان التوصيل المطلوب غير مسجل."
                    ),
                    suggested_repair=None if customer.has_delivery_address else "Confirm delivery address with customer.",
                    suggested_repair_ar=None if customer.has_delivery_address else "تأكيد عنوان التوصيل مع العميل.",
                )
            )

    rules.append(
        _RuleConstraint(
            code="ORDER_HAS_ITEMS",
            severity=ValidationStatus.FAILED,
            satisfied=len(lines) > 0,
            message="Order contains candidate line items." if lines else "No order line items were detected.",
            message_ar="يحتوي الطلب على بنود منتجات صالحة." if lines else "لم يتم استخراج أي بنود منتجات من الرسالة.",
            suggested_repair=None if lines else "Add at least one product line manually.",
            suggested_repair_ar=None if lines else "أضف بند منتج واحد على الأقل يدوياً.",
        )
    )

    seen_skus: dict[str, int] = {}
    for line in lines:
        ln = line.line_number
        has_prod = line.assigned_product_id is not None
        rules.append(
            _RuleConstraint(
                code=f"LINE_{ln}_PRODUCT_MATCHED",
                severity=ValidationStatus.FAILED,
                satisfied=has_prod,
                message=(
                    f"Line {ln} matched to SKU {line.assigned_sku}."
                    if has_prod
                    else f"Line {ln} ('{line.extracted.raw_description}') has no confirmed catalog match."
                ),
                message_ar=(
                    f"البند {ln} تم ربطه بالصنف {line.assigned_sku}."
                    if has_prod
                    else f"البند {ln} («{line.extracted.raw_description}») غير مربوط بصنف من الكتالوج."
                ),
                suggested_repair=None if has_prod else "Select a catalog SKU or register a new product/alias.",
                suggested_repair_ar=None if has_prod else "اختر الصنف الصحيح من البدائل أو أضف اسماً بديلاً.",
            )
        )

        if line.assigned_sku:
            if line.assigned_sku in seen_skus:
                rules.append(
                    _RuleConstraint(
                        code=f"LINE_{ln}_NO_DUPLICATE_SKU",
                        severity=ValidationStatus.WARNING,
                        satisfied=False,
                        message=f"SKU {line.assigned_sku} appears on both line {seen_skus[line.assigned_sku]} and line {ln}.",
                        message_ar=f"الصنف {line.assigned_sku} مكرر في البند {seen_skus[line.assigned_sku]} والبند {ln}.",
                        suggested_repair="Merge quantities or verify separate packaging tiers.",
                        suggested_repair_ar="ادمج الكميات أو تأكد من أن التكرار مقصود.",
                    )
                )
            seen_skus[line.assigned_sku] = ln

        qty = line.extracted.extracted_quantity
        qty_ok = qty is not None and qty > 0
        rules.append(
            _RuleConstraint(
                code=f"LINE_{ln}_VALID_QUANTITY",
                severity=ValidationStatus.FAILED,
                satisfied=qty_ok,
                message=(
                    f"Line {ln} quantity ({qty:g}) is positive."
                    if qty_ok
                    else f"Line {ln} is missing a valid positive quantity."
                ),
                message_ar=(
                    f"كمية البند {ln} ({qty:g}) موجبة وصالحة."
                    if qty_ok
                    else f"البند {ln} يفتقد لكمية رقمية صالحة."
                ),
                suggested_repair=None if qty_ok else "Confirm requested quantity with customer.",
                suggested_repair_ar=None if qty_ok else "تأكيد الكمية المطلوبة من العميل.",
            )
        )

        if "implicit_unit_quantity_one" in line.extracted.extraction_ambiguities and not line.is_human_confirmed:
            rules.append(
                _RuleConstraint(
                    code=f"LINE_{ln}_IMPLICIT_QTY_CONFIRM",
                    severity=ValidationStatus.REQUIRES_HUMAN_REVIEW,
                    satisfied=False,
                    message=f"Line {ln} had no explicit number before unit; assumed 1 {line.extracted.extracted_unit}.",
                    message_ar=f"البند {ln} لم يُذكر قبله رقم؛ افترض النظام كمية (1) — يُرجى التأكيد.",
                    suggested_repair="Confirm quantity = 1 or enter customer requested count.",
                    suggested_repair_ar="تأكيد الكمية (1) أو تعديلها للعدد الصحيح.",
                )
            )

        if line.packaging_solution is not None and not line.is_human_confirmed:
            pkg = line.packaging_solution
            if not pkg.is_exact:
                rules.append(
                    _RuleConstraint(
                        code=f"LINE_{ln}_PACKAGING_EXACT",
                        severity=ValidationStatus.REQUIRES_HUMAN_REVIEW,
                        satisfied=False,
                        message=f"Line {ln}: {pkg.explanation}",
                        message_ar=f"البند {ln}: {pkg.explanation_ar or pkg.explanation}",
                        suggested_repair=f"Confirm rounded valid pack ({pkg.allocated_base_units} base units) with customer.",
                        suggested_repair_ar=f"تأكيد الكمية المقربة لأقرب كرتونة كاملة ({pkg.allocated_base_units} وحدة).",
                    )
                )
            if not pkg.meets_moq:
                rules.append(
                    _RuleConstraint(
                        code=f"LINE_{ln}_MEETS_MOQ",
                        severity=ValidationStatus.FAILED,
                        satisfied=False,
                        message=f"Line {ln} does not meet product Minimum Order Quantity.",
                        message_ar=f"البند {ln} أقل من الحد الأدنى لكمية الطلب (MOQ).",
                        suggested_repair="Increase quantity to meet MOQ.",
                        suggested_repair_ar="زيادة الكمية للوصول للحد الأدنى.",
                    )
                )

        if (
            not line.is_human_confirmed
            and line.matching_outcome
            in (
                MatchingOutcome.POSSIBLE_MATCH,
                MatchingOutcome.MULTIPLE_MATCHES,
                MatchingOutcome.CONFLICTING,
            )
        ):
            rules.append(
                _RuleConstraint(
                    code=f"LINE_{ln}_MATCH_DISAMBIGUATION",
                    severity=ValidationStatus.REQUIRES_HUMAN_REVIEW,
                    satisfied=False,
                    message=f"Line {ln} matching outcome is '{line.matching_outcome.value}' and requires human selection.",
                    message_ar=f"البند {ln} في حالة «{line.matching_outcome.value}» ويتطلب تأكيد المراجع.",
                    suggested_repair="Review top candidate alternatives against original message.",
                    suggested_repair_ar="اختر الصنف الصحيح من البدائل المقترحة.",
                )
            )

    hard_rules = [r for r in rules if r.severity == ValidationStatus.FAILED]
    overall_feasible = _is_subset_feasible(hard_rules)
    mus_codes = _extract_mus(hard_rules) if not overall_feasible else []
    mus_set = set(mus_codes)

    formatted_results = [
        ValidationRuleResult(
            rule_code=r.code,
            status=ValidationStatus.PASSED if r.satisfied else r.severity,
            is_in_mus=(r.code in mus_set),
            message=r.message,
            message_ar=r.message_ar,
            suggested_repair=r.suggested_repair,
            suggested_repair_ar=r.suggested_repair_ar,
        )
        for r in rules
    ]
    return overall_feasible, formatted_results, mus_codes
