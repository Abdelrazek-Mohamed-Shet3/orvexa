from __future__ import annotations

import math
from collections import Counter
from app.ai_pipeline.normalizer import normalize_arabic_english


def _char_ngrams(text: str, n: int = 3) -> Counter[str]:
    padded = f" {text} "
    if len(padded) < n:
        return Counter([padded])
    return Counter(padded[i : i + n] for i in range(len(padded) - n + 1))


def ngram_cosine_similarity(a: str, b: str, n: int = 3) -> float:
    """Deterministic character n-gram cosine similarity resilient to Arabic/English typos."""
    ca = _char_ngrams(normalize_arabic_english(a), n)
    cb = _char_ngrams(normalize_arabic_english(b), n)
    if not ca or not cb:
        return 0.0
    common = set(ca.keys()) & set(cb.keys())
    dot = sum(ca[k] * cb[k] for k in common)
    norm_a = math.sqrt(sum(v * v for v in ca.values()))
    norm_b = math.sqrt(sum(v * v for v in cb.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class CatalogBM25:
    """Lightweight deterministic BM25 scorer over normalized catalog names and aliases."""

    def __init__(self, documents: list[str], k1: float = 1.5, b: float = 0.75) -> None:
        self.k1 = k1
        self.b = b
        self.tokenized = [normalize_arabic_english(d).split() for d in documents]
        self.n_docs = len(self.tokenized)
        self.avg_dl = (
            sum(len(t) for t in self.tokenized) / self.n_docs if self.n_docs > 0 else 1.0
        ) or 1.0
        self.doc_freqs: Counter[str] = Counter()
        for tokens in self.tokenized:
            for tok in set(tokens):
                self.doc_freqs[tok] += 1

    def score_all(self, query: str) -> list[float]:
        if self.n_docs == 0:
            return []
        q_tokens = normalize_arabic_english(query).split()
        raw_scores: list[float] = []
        for doc_tokens in self.tokenized:
            dl = len(doc_tokens) or 1
            tf_map = Counter(doc_tokens)
            score = 0.0
            for qt in q_tokens:
                df = self.doc_freqs.get(qt, 0)
                if df == 0:
                    continue
                idf = math.log((self.n_docs - df + 0.5) / (df + 0.5) + 1.0)
                tf = tf_map.get(qt, 0)
                if tf > 0:
                    denom = tf + self.k1 * (1.0 - self.b + self.b * (dl / self.avg_dl))
                    score += idf * (tf * (self.k1 + 1.0)) / denom
            raw_scores.append(score)

        max_s = max(raw_scores, default=0.0)
        if max_s <= 0.0:
            return [0.0] * self.n_docs
        return [s / max_s for s in raw_scores]
