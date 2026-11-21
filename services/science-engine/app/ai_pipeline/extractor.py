from __future__ import annotations

import csv
import io
import re

from app.ai_pipeline.normalizer import UNIT_SYNONYMS, canonicalize_unit, normalize_arabic_english
from app.schemas import ExtractedOrderLine, ExtractionEnvelope

_UNIT_PATTERN = "|".join(sorted((re.escape(k) for k in UNIT_SYNONYMS), key=len, reverse=True))
_QTY_UNIT_RE = re.compile(
    rf"(?P<qty>\d+(?:[.,]\d+)?)\s*(?P<unit>{_UNIT_PATTERN})\b",
    re.IGNORECASE,
)
_LEADING_UNIT_RE = re.compile(
    rf"^(?:[-*•]\s*)?(?P<unit>{_UNIT_PATTERN})\s+(?P<rest>.+)$",
    re.IGNORECASE,
)
_BARE_NUMBER_RE = re.compile(r"(?P<qty>\d+(?:[.,]\d+)?)")
_EXPLICIT_SKU_RE = re.compile(r"\b([A-Z]{2,}[A-Z0-9]*(?:-[A-Z0-9]+)+)\b")

_GREETING_ONLY = {
    "السلام عليكم",
    "وعليكم السلام",
    "صباح الخير",
    "مساء الخير",
    "لو سمحت",
    "من فضلك",
    "عايز اطلب",
    "محتاجين الطلبيه دي",
    "شكرا",
    "جزاكم الله خيرا",
    "تحياتي",
    "dear supplier",
    "regards",
}

_HEADER_PREFIX_RE = re.compile(
    r"(?:عايزين|عاوزين|محتاجين|ارسلوا|ابعتوا|طلبيه|الطلبيه|توريد|طلب شراء|امر توريد|أمر توريد|طلب رقم|purchase order|po\s*#|order for|please supply)\b",
    re.IGNORECASE,
)
_CUSTOMER_HINT_RE = re.compile(r"(?:لمحل|لشركه|لمصنع|لمشروع|للمستشفي|لعميل|عميل|لـ|company|client|for)\s+([^\n:،]+)", re.IGNORECASE)
_DELIVERY_LINE_RE = re.compile(r"^(?:التوصيل|العنوان|الميعاد|تسليم|ملاحظات|المخزن|الموقع|note|address|delivery|site|warehouse)\s*[:：]", re.IGNORECASE)


def _is_preamble_or_header_line(stripped: str, normalized: str) -> bool:
    if normalized in _GREETING_ONLY:
        return True
    if _DELIVERY_LINE_RE.match(stripped):
        return True
    has_unit = bool(re.search(rf"\b(?:{_UNIT_PATTERN})\b", stripped, re.IGNORECASE))
    has_sku = bool(_EXPLICIT_SKU_RE.search(stripped))
    if stripped.rstrip().endswith((":", "：")) and not has_unit and not has_sku:
        return True
    if _HEADER_PREFIX_RE.search(normalized) and not has_unit and not has_sku and not re.search(r"\b\d+\b", normalized):
        return True
    return False


def _looks_like_csv_po(raw_text: str) -> bool:
    lines = [ln.strip() for ln in raw_text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return False
    first = lines[0].lower()
    if "," in first or "\t" in first:
        header_tokens = ("sku", "item", "product", "qty", "quantity", "unit", "الصنف", "الكود", "الكمية", "الوحدة")
        return any(tok in first for tok in header_tokens)
    return False


def _extract_from_csv_po(raw_text: str) -> ExtractionEnvelope:
    delimiter = "\t" if "\t" in raw_text.splitlines()[0] else ","
    reader = csv.DictReader(io.StringIO(raw_text.strip()), delimiter=delimiter)
    lines: list[ExtractedOrderLine] = []
    cursor = 0
    idx = 1

    for row in reader:
        norm_row = {(k or "").strip().lower(): (v or "").strip() for k, v in row.items()}
        sku = norm_row.get("sku") or norm_row.get("code") or norm_row.get("الكود") or None
        desc = (
            norm_row.get("product")
            or norm_row.get("description")
            or norm_row.get("item")
            or norm_row.get("الصنف")
            or norm_row.get("الوصف")
            or sku
            or ""
        )
        raw_qty = norm_row.get("qty") or norm_row.get("quantity") or norm_row.get("الكمية") or ""
        raw_unit = norm_row.get("unit") or norm_row.get("uom") or norm_row.get("الوحدة") or ""

        qty: float | None = None
        if raw_qty:
            try:
                qty = float(raw_qty.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")).replace(",", "."))
            except ValueError:
                qty = None

        unit = canonicalize_unit(raw_unit) if raw_unit else None
        ambiguities: list[str] = []
        if qty is None:
            ambiguities.append("missing_quantity")
        if unit is None:
            ambiguities.append("missing_or_ambiguous_unit")

        display = " | ".join(part for part in [sku, desc, f"{raw_qty} {raw_unit}".strip()] if part)
        start = raw_text.find(desc, cursor) if desc else cursor
        if start == -1:
            start = cursor
        end = start + max(len(desc), 1)
        cursor = end

        lines.append(
            ExtractedOrderLine(
                line_number=idx,
                raw_description=display,
                normalized_description=normalize_arabic_english(f"{sku or ''} {desc}".strip()),
                source_span_start=start,
                source_span_end=min(end, len(raw_text)),
                extracted_quantity=qty,
                extracted_unit=unit,
                explicit_sku=sku.upper() if sku else None,
                extraction_ambiguities=ambiguities,
            )
        )
        idx += 1

    return ExtractionEnvelope(
        lines=lines,
        detected_customer_hint=None,
        header_notes=["Structured CSV/ERP Purchase Order Feed"],
    )


def extract_order_envelope(raw_text: str) -> ExtractionEnvelope:
    """
    Provenance-preserving structured extractor for both unstructured Arabic/English PO text
    and structured CSV/TSV enterprise purchase order feeds.
    """
    if _looks_like_csv_po(raw_text):
        return _extract_from_csv_po(raw_text)

    lines: list[ExtractedOrderLine] = []
    header_notes: list[str] = []
    detected_customer_hint: str | None = None

    cursor = 0
    raw_segments = re.split(r"[\n;،]+", raw_text)
    line_idx = 1

    for seg in raw_segments:
        seg_start = raw_text.find(seg, cursor)
        if seg_start == -1:
            seg_start = cursor
        seg_end = seg_start + len(seg)
        cursor = seg_end

        stripped = seg.strip()
        if not stripped:
            continue

        digit_norm_seg = stripped.translate(str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789"))
        normalized_seg = normalize_arabic_english(digit_norm_seg)

        if _is_preamble_or_header_line(stripped, normalized_seg):
            header_notes.append(stripped)
            hint_match = _CUSTOMER_HINT_RE.search(normalized_seg)
            if hint_match and not detected_customer_hint:
                hint_clean = re.sub(r"\b(لو سمحت|من فضلك|يا فندم|please)\b", "", hint_match.group(1)).strip()
                if hint_clean:
                    detected_customer_hint = hint_clean
            continue

        sku_match = _EXPLICIT_SKU_RE.search(digit_norm_seg)
        explicit_sku = sku_match.group(1) if sku_match else None

        qty: float | None = None
        unit: str | None = None
        desc_text = digit_norm_seg
        ambiguities: list[str] = []

        qty_unit_match = _QTY_UNIT_RE.search(digit_norm_seg)
        if qty_unit_match:
            qty = float(qty_unit_match.group("qty").replace(",", "."))
            unit = canonicalize_unit(qty_unit_match.group("unit"))
            desc_text = (
                digit_norm_seg[: qty_unit_match.start()] + " " + digit_norm_seg[qty_unit_match.end() :]
            ).strip()
        else:
            leading_unit_match = _LEADING_UNIT_RE.match(digit_norm_seg)
            if leading_unit_match:
                qty = 1.0
                unit = canonicalize_unit(leading_unit_match.group("unit"))
                desc_text = leading_unit_match.group("rest").strip()
                ambiguities.append("implicit_unit_quantity_one")
            else:
                for m in _BARE_NUMBER_RE.finditer(digit_norm_seg):
                    after = digit_norm_seg[m.end() :].strip().lower()
                    if not re.match(r"^(لتر|جرام|جم|كجم|كيلو|مل|مم|سم|امبير|أمبير|g|kg|l|ml|mm|cm|a|v)\b", after):
                        qty = float(m.group("qty").replace(",", "."))
                        desc_text = (
                            digit_norm_seg[: m.start()] + " " + digit_norm_seg[m.end() :]
                        ).strip()
                        break

        if qty is None:
            ambiguities.append("missing_quantity")
        if unit is None:
            ambiguities.append("missing_or_ambiguous_unit")

        normalized_desc = normalize_arabic_english(desc_text)
        if not normalized_desc and explicit_sku:
            normalized_desc = explicit_sku.lower()

        if qty is None and len(normalized_desc.split()) <= 1 and not explicit_sku:
            continue

        lines.append(
            ExtractedOrderLine(
                line_number=line_idx,
                raw_description=stripped,
                normalized_description=normalized_desc,
                source_span_start=seg_start,
                source_span_end=seg_end,
                extracted_quantity=qty,
                extracted_unit=unit,
                explicit_sku=explicit_sku,
                extraction_ambiguities=ambiguities,
            )
        )
        line_idx += 1

    return ExtractionEnvelope(
        lines=lines,
        detected_customer_hint=detected_customer_hint,
        header_notes=header_notes,
    )


def extract_candidate_lines(raw_text: str) -> list[ExtractedOrderLine]:
    return extract_order_envelope(raw_text).lines
