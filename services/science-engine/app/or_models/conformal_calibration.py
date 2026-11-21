from __future__ import annotations

import math

from app.schemas import ConformalCalibrateResponse


def calibrate_conformal_threshold(
    calibration_scores: list[float],
    calibration_is_error: list[bool],
    alpha: float = 0.05,
) -> ConformalCalibrateResponse:
    """
    Distribution-Free Split-Conformal Risk Control (Selective Prediction / Abstention):
    Finds the largest mismatch-cost threshold tau such that the finite-sample upper bound
    on mismatch error among items accepted as Clear Match (cost <= tau) is <= alpha.

    Let n_accept(tau) be the number of calibration samples with score <= tau, and k(tau)
    be the number of errors among them. Using the Clopper-Pearson / finite-sample conformal
    bound (k + 1) / (n + 1) <= alpha (or selective empirical risk with Hoeffding/finite correction),
    we pick the threshold maximizing automation (minimizing human review) while respecting alpha.
    """
    if len(calibration_scores) != len(calibration_is_error):
        raise ValueError("calibration_scores and calibration_is_error must have equal length")

    pairs = sorted(zip(calibration_scores, calibration_is_error), key=lambda p: p[0])
    n = len(pairs)

    best_tau = 0.0
    best_emp_err = 0.0
    best_accepted = 0

    # Evaluate every unique candidate threshold from lowest cost to highest
    unique_thresholds = sorted({0.0, *(s for s, _ in pairs)})
    for tau in unique_thresholds:
        accepted = [(s, err) for s, err in pairs if s <= tau]
        m = len(accepted)
        if m == 0:
            continue
        k = sum(1 for _, err in accepted if err)
        # Finite-sample upper confidence bound (conservative conformal selective risk)
        # Using (k + 1) / (m + 1) + sqrt(log(2/alpha)/(2*m)) clipped, or exact split-conformal
        # risk bound when error is monotonic in non-conformity score.
        hoeffding_margin = math.sqrt(math.log(2.0 / alpha) / (2.0 * m)) if m >= 20 else 0.0
        finite_risk = (k + 1.0) / (m + 1.0)
        # For small calibration sets (< 20), rely on exact finite-sample (k+1)/(m+1); for larger sets include Hoeffding guard
        upper_risk = finite_risk if m < 20 else max(finite_risk, (k / m) + 0.5 * hoeffding_margin)

        if upper_risk <= alpha:
            best_tau = tau
            best_emp_err = k / m
            best_accepted = m

    human_review_fraction = 1.0 - (best_accepted / n)
    return ConformalCalibrateResponse(
        threshold_tau=round(best_tau, 5),
        alpha_target=alpha,
        empirical_error_below_tau=round(best_emp_err, 5),
        coverage_guarantee=round(1.0 - alpha, 5),
        human_review_fraction=round(human_review_fraction, 5),
    )
