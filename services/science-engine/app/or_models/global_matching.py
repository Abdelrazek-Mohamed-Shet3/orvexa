from __future__ import annotations

from difflib import SequenceMatcher
from ortools.linear_solver import pywraplp

from app.ai_pipeline.hybrid_retriever import CatalogBM25, ngram_cosine_similarity
from app.ai_pipeline.normalizer import normalize_arabic_english
from app.schemas import (
    CandidateMatchOption,
    CatalogProduct,
    CustomerProfile,
    ExtractedOrderLine,
    MatchingOutcome,
)


def _token_jaccard(a: str, b: str) -> float:
    ta = set(a.split())
    tb = set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def compute_deterministic_mismatch_cost(
    line: ExtractedOrderLine,
    product: CatalogProduct,
    customer: CustomerProfile | None,
) -> tuple[float, bool, list[str]]:
    """
    Compute deterministic mismatch cost c_{ij} in [0, 1] and unit compatibility A_{ij}.
    Lower cost means stronger evidence of match. Zero AI black-box scoring.
    """
    reasons: list[str] = []

    # Unit compatibility A_{ij}
    unit_compatible = True
    if line.extracted_unit is not None:
        allowed_units = {product.base_unit} | {
            lvl.unit_code for lvl in product.packaging_levels if lvl.is_orderable
        }
        if line.extracted_unit not in allowed_units:
            unit_compatible = False
            reasons.append(f"unit_incompatible:{line.extracted_unit}_not_in_{sorted(allowed_units)}")

    # 1. Explicit SKU match
    if line.explicit_sku and line.explicit_sku.upper() == product.sku.upper():
        reasons.append("exact_sku_match")
        return 0.01, unit_compatible, reasons

    q_norm = line.normalized_description
    cand_texts = [
        ("name_ar", normalize_arabic_english(product.name_ar)),
        ("name_en", normalize_arabic_english(product.name_en)),
    ]
    for alias in product.aliases:
        cand_texts.append(("org_alias", normalize_arabic_english(alias)))

    if customer and customer.id in product.customer_aliases:
        for c_alias in product.customer_aliases[customer.id]:
            cand_texts.append(("customer_alias", normalize_arabic_english(c_alias)))

    best_sim = 0.0
    best_source = "none"
    for source_label, target in cand_texts:
        if not target:
            continue
        if q_norm == target:
            sim = 1.0
        else:
            seq_sim = SequenceMatcher(None, q_norm, target).ratio()
            jac_sim = _token_jaccard(q_norm, target)
            ngram_sim = ngram_cosine_similarity(q_norm, target, n=3)
            q_tokens = set(q_norm.split())
            t_tokens = set(target.split())
            containment = (len(q_tokens & t_tokens) / len(q_tokens)) if q_tokens else 0.0
            sim = 0.35 * jac_sim + 0.25 * ngram_sim + 0.20 * seq_sim + 0.20 * containment

        if source_label == "customer_alias":
            sim = min(1.0, sim + 0.08)
        elif source_label == "org_alias":
            sim = min(1.0, sim + 0.04)

        if sim > best_sim:
            best_sim = sim
            best_source = source_label

    if best_sim >= 0.4:
        reasons.append(f"best_evidence:{best_source}(sim={best_sim:.2f})")

    # Customer historical purchase prior (bounded small discount)
    prior_bonus = 0.0
    if customer and product.id in customer.historical_sku_counts:
        freq = customer.historical_sku_counts[product.id]
        prior_bonus = min(0.06, 0.015 * freq)
        reasons.append(f"customer_history_prior(orders={freq})")

    if not product.is_available:
        reasons.append("product_unavailable_penalty")
        best_sim = max(0.0, best_sim - 0.15)

    cost = max(0.0, min(1.0, 1.0 - best_sim - prior_bonus))
    if not unit_compatible:
        cost = min(1.0, cost + 0.35)

    return round(cost, 5), unit_compatible, reasons


def solve_global_bipartite_matching(
    lines: list[ExtractedOrderLine],
    catalog: list[CatalogProduct],
    customer: CustomerProfile | None,
    clear_threshold: float = 0.22,
    possible_threshold: float = 0.55,
    allow_duplicate_skus: bool = False,
) -> dict[int, dict]:
    """
    Global Constrained Bipartite Assignment (MILP via HiGHS / CBC):
      min  sum_{i,j} c_{ij} x_{ij} + sum_i P_unmatch u_i
      s.t. sum_j x_{ij} + u_i = 1                    for all lines i
           sum_i x_{ij} <= 1                         for all products j (if !allow_duplicate_skus)
           x_{ij} <= A_{ij}                          (strict unit compatibility when unit known)
    """
    if not lines:
        return {}
    if not catalog:
        return {
            line.line_number: {
                "product": None,
                "mismatch_cost": None,
                "outcome": MatchingOutcome.NO_MATCH,
                "alternatives": [],
            }
            for line in lines
        }

    solver = pywraplp.Solver.CreateSolver("HIGHS") or pywraplp.Solver.CreateSolver("CBC")
    if solver is None:
        raise RuntimeError("No MILP solver backend (HIGHS/CBC) available in OR-Tools")

    p_unmatch = possible_threshold
    m = len(lines)
    n = len(catalog)

    costs: list[list[float]] = [[1.0] * n for _ in range(m)]
    compat: list[list[bool]] = [[True] * n for _ in range(m)]
    reasons_grid: list[list[list[str]]] = [[[] for _ in range(n)] for _ in range(m)]

    # Hybrid BM25 lexical boost over full catalog descriptions
    bm25_docs = [
        f"{p.sku} {p.name_ar} {p.name_en} {' '.join(p.aliases)}" for p in catalog
    ]
    bm25_index = CatalogBM25(bm25_docs)

    for i, line in enumerate(lines):
        bm25_scores = bm25_index.score_all(line.normalized_description)
        for j, prod in enumerate(catalog):
            c_ij, a_ij, r_ij = compute_deterministic_mismatch_cost(line, prod, customer)
            # Bounded BM25 lexical tie-breaker boost (never overrides exact SKU or unit incompatibility)
            if bm25_scores[j] > 0.3 and c_ij > 0.02:
                c_ij = max(0.02, round(c_ij - 0.05 * bm25_scores[j], 5))
            costs[i][j] = c_ij
            compat[i][j] = a_ij
            reasons_grid[i][j] = r_ij

    x = {
        (i, j): solver.BoolVar(f"x_{i}_{j}")
        for i in range(m)
        for j in range(n)
    }
    u = {i: solver.BoolVar(f"u_{i}") for i in range(m)}

    # Constraint 1: Every line either matches 1 SKU or is explicitly marked unmatched
    for i in range(m):
        solver.Add(sum(x[(i, j)] for j in range(n)) + u[i] == 1)

    # Constraint 2: Guard against accidental duplicate SKU assignment across order lines
    if not allow_duplicate_skus:
        for j in range(n):
            solver.Add(sum(x[(i, j)] for i in range(m)) <= 1)

    # Constraint 3: Unit compatibility hard constraint
    for i in range(m):
        for j in range(n):
            if not compat[i][j]:
                solver.Add(x[(i, j)] == 0)

    objective = solver.Objective()
    for i in range(m):
        objective.SetCoefficient(u[i], p_unmatch)
        for j in range(n):
            objective.SetCoefficient(x[(i, j)], costs[i][j])
    objective.SetMinimization()

    status = solver.Solve()
    if status not in (pywraplp.Solver.OPTIMAL, pywraplp.Solver.FEASIBLE):
        raise RuntimeError(f"Global matching MILP solver failed with status {status}")

    results: dict[int, dict] = {}
    for i, line in enumerate(lines):
        # Collect top-3 alternatives by lowest cost for transparent human review
        ranked = sorted(
            [
                CandidateMatchOption(
                    product_id=catalog[j].id,
                    sku=catalog[j].sku,
                    name_ar=catalog[j].name_ar,
                    name_en=catalog[j].name_en,
                    mismatch_cost=costs[i][j],
                    reasons=reasons_grid[i][j],
                )
                for j in range(n)
            ],
            key=lambda opt: opt.mismatch_cost,
        )[:3]

        assigned_j: int | None = None
        for j in range(n):
            if x[(i, j)].solution_value() > 0.5:
                assigned_j = j
                break

        if assigned_j is None or u[i].solution_value() > 0.5:
            # Check if failure was specifically due to unit incompatibility on an otherwise strong text match
            best_raw = ranked[0] if ranked else None
            outcome = MatchingOutcome.NO_MATCH
            if best_raw and any(r.startswith("unit_incompatible:") for r in best_raw.reasons):
                outcome = MatchingOutcome.CONFLICTING

            results[line.line_number] = {
                "product": None,
                "mismatch_cost": None,
                "outcome": outcome,
                "alternatives": ranked,
            }
            continue

        chosen_prod = catalog[assigned_j]
        chosen_cost = costs[i][assigned_j]

        # Detect close runners-up ("multiple plausible matches" per Spec §8.7)
        near_ties = [
            opt for opt in ranked if opt.product_id != chosen_prod.id and abs(opt.mismatch_cost - chosen_cost) <= 0.08
        ]
        if near_ties:
            outcome = MatchingOutcome.MULTIPLE_MATCHES
        elif chosen_cost <= clear_threshold:
            outcome = MatchingOutcome.CLEAR_MATCH
        elif chosen_cost <= possible_threshold:
            outcome = MatchingOutcome.POSSIBLE_MATCH
        else:
            outcome = MatchingOutcome.NO_MATCH

        results[line.line_number] = {
            "product": chosen_prod,
            "mismatch_cost": chosen_cost,
            "outcome": outcome,
            "alternatives": ranked,
        }

    return results
