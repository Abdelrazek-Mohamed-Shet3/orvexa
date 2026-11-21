from __future__ import annotations

import re

_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
_TASHKEEL_RE = re.compile(r"[\u064B-\u065F\u0670]")

UNIT_SYNONYMS: dict[str, str] = {
    # Pallet
    "باليت": "pallet",
    "بالتة": "pallet",
    "بالته": "pallet",
    "طبليه": "pallet",
    "طبلية": "pallet",
    "pallet": "pallet",
    "pallets": "pallet",
    "plt": "pallet",
    # Carton / Box
    "كرتونة": "carton",
    "كرتونه": "carton",
    "كراتين": "carton",
    "كرتون": "carton",
    "صندوق": "carton",
    "carton": "carton",
    "cartons": "carton",
    "ctn": "carton",
    "ctns": "carton",
    "box": "box",
    "boxes": "box",
    # Roll / Reel / Drum
    "رول": "roll",
    "رولات": "roll",
    "لفه": "roll",
    "لفة": "roll",
    "roll": "roll",
    "rolls": "roll",
    "بكرة": "reel",
    "بكره": "reel",
    "reel": "reel",
    "reels": "reel",
    "برميل": "drum",
    "براميل": "drum",
    "drum": "drum",
    "drums": "drum",
    # Pack / Sack
    "باكت": "pack",
    "باكته": "pack",
    "باكتة": "pack",
    "باكيت": "pack",
    "pack": "pack",
    "packs": "pack",
    "pkt": "pack",
    "علبة": "pack",
    "علبه": "pack",
    "علب": "pack",
    "كيس": "pack",
    "اكياس": "pack",
    "أكياس": "pack",
    "عبوة": "pack",
    "عبوه": "pack",
    "شكارة": "sack",
    "شكاره": "sack",
    "شيكارة": "sack",
    "شيكاره": "sack",
    "شكاير": "sack",
    "sack": "sack",
    "sacks": "sack",
    # Weight / Length
    "طن": "ton",
    "اطنان": "ton",
    "أطنان": "ton",
    "ton": "ton",
    "tons": "ton",
    "mt": "ton",
    "كجم": "kg",
    "كيلو": "kg",
    "kg": "kg",
    "متر": "meter",
    "امتار": "meter",
    "أمتار": "meter",
    "meter": "meter",
    "meters": "meter",
    "m": "meter",
    # Piece / Unit / Bottle
    "زجاجة": "bottle",
    "زجاجه": "bottle",
    "bottle": "bottle",
    "bottles": "bottle",
    "قطعة": "piece",
    "قطعه": "piece",
    "قطع": "piece",
    "حبة": "piece",
    "حبه": "piece",
    "وحدة": "unit",
    "وحده": "unit",
    "وحدات": "unit",
    "unit": "unit",
    "units": "unit",
    "piece": "piece",
    "pieces": "piece",
    "pcs": "piece",
    "pc": "piece",
}


def normalize_arabic_english(text: str) -> str:
    """Normalize Arabic/English mixed enterprise order text without altering technical tokens."""
    s = text.translate(_ARABIC_DIGITS)
    s = _TASHKEEL_RE.sub("", s)
    s = re.sub(r"[أإآ]", "ا", s)
    s = s.replace("ة", "ه").replace("ى", "ي")
    s = s.lower()
    s = re.sub(r"[^\w\s\.\-/]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def canonicalize_unit(raw_unit: str | None) -> str | None:
    if not raw_unit:
        return None
    cleaned = raw_unit.strip().lower()
    if cleaned in UNIT_SYNONYMS:
        return UNIT_SYNONYMS[cleaned]
    norm = normalize_arabic_english(cleaned)
    return UNIT_SYNONYMS.get(norm, norm or None)
