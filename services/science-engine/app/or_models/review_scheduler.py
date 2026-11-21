from __future__ import annotations

import math
from ortools.sat.python import cp_model

from app.schemas import (
    QueueingDiagnostics,
    ReviewOrderJob,
    ReviewerCapacity,
    ScheduleReviewsResponse,
    ScheduledAssignment,
)


def compute_queueing_diagnostics(
    arrival_rate_per_hour: float,
    mean_service_minutes: float,
    reviewers: list[ReviewerCapacity],
) -> QueueingDiagnostics:
    """
    Exact M/M/c (Erlang-C) and Little's Law (L = lambda * W) queueing diagnostics
    for the Operations Manager dashboard (Spec §8.11, §8.12).
    """
    c = max(1, len(reviewers))
    avg_speed = sum(r.speed_multiplier for r in reviewers) / c if reviewers else 1.0
    mu_per_server_per_hour = (60.0 / mean_service_minutes) * avg_speed
    total_capacity_per_hour = c * mu_per_server_per_hour
    rho = arrival_rate_per_hour / total_capacity_per_hour

    if rho >= 1.0:
        return QueueingDiagnostics(
            arrival_rate_per_hour=round(arrival_rate_per_hour, 3),
            total_service_capacity_per_hour=round(total_capacity_per_hour, 3),
            utilization_rho=round(rho, 4),
            is_stable=False,
            littles_law_wip=None,
            erlang_c_wait_probability=1.0,
            expected_queue_wait_minutes=None,
            bottleneck_alert=(
                f"UNSTABLE QUEUE (rho={rho:.2f} >= 1.0): Arrival rate ({arrival_rate_per_hour:.1f}/hr) "
                f"exceeds reviewer capacity ({total_capacity_per_hour:.1f}/hr). Backlog will grow unboundedly."
            ),
        )

    a = arrival_rate_per_hour / mu_per_server_per_hour  # Offered traffic in Erlangs
    sum_terms = sum((a ** k) / math.factorial(k) for k in range(c))
    last_term = (a ** c) / (math.factorial(c) * (1.0 - rho))
    p0 = 1.0 / (sum_terms + last_term)
    erlang_c = last_term * p0

    # Expected wait time in queue W_q (hours -> minutes)
    wq_hours = erlang_c / (total_capacity_per_hour - arrival_rate_per_hour)
    wq_minutes = wq_hours * 60.0
    w_total_hours = wq_hours + (1.0 / mu_per_server_per_hour)
    littles_wip = arrival_rate_per_hour * w_total_hours

    alert = None
    if rho >= 0.85:
        alert = (
            f"HIGH UTILIZATION WARNING (rho={rho:.2f}): Expected queue wait is {wq_minutes:.1f} min. "
            "Consider assigning an additional reviewer."
        )

    return QueueingDiagnostics(
        arrival_rate_per_hour=round(arrival_rate_per_hour, 3),
        total_service_capacity_per_hour=round(total_capacity_per_hour, 3),
        utilization_rho=round(rho, 4),
        is_stable=True,
        littles_law_wip=round(littles_wip, 2),
        erlang_c_wait_probability=round(erlang_c, 4),
        expected_queue_wait_minutes=round(wq_minutes, 2),
        bottleneck_alert=alert,
    )


def solve_review_schedule(
    orders: list[ReviewOrderJob],
    reviewers: list[ReviewerCapacity],
    arrival_rate_per_hour: float = 12.0,
    mean_service_minutes: float = 8.0,
) -> ScheduleReviewsResponse:
    """
    Parallel Machine Scheduling with Release Dates and Weighted Tardiness + Makespan Balancing:
      P_m | r_j | sum(w_j * T_j) + lambda * C_max
    Solved deterministically via OR-Tools CP-SAT.
    """
    queue_diag = compute_queueing_diagnostics(arrival_rate_per_hour, mean_service_minutes, reviewers)

    if not orders or not reviewers:
        return ScheduleReviewsResponse(
            solver_status="EMPTY",
            objective_value=0.0,
            makespan_minutes=0,
            total_weighted_tardiness=0.0,
            assignments=[],
            queueing_diagnostics=queue_diag,
        )

    model = cp_model.CpModel()

    # Deterministic review duration estimate p_j (minutes)
    def base_proc_minutes(job: ReviewOrderJob) -> int:
        return max(2, 2 + 2 * job.uncertain_lines + job.validation_warnings)

    horizon = (
        max(j.arrival_minute for j in orders)
        + max((r.available_from_minute for r in reviewers), default=0)
        + sum(int(math.ceil(base_proc_minutes(j) / min(r.speed_multiplier for r in reviewers))) for j in orders)
        + 60
    )

    assign_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    start_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    end_vars: dict[tuple[int, int], cp_model.IntVar] = {}
    job_end: list[cp_model.IntVar] = []
    job_tardiness: list[cp_model.IntVar] = []

    for r_idx, rev in enumerate(reviewers):
        intervals_on_r = []
        for j_idx, job in enumerate(orders):
            dur = max(1, int(math.ceil(base_proc_minutes(job) / rev.speed_multiplier)))
            earliest = max(job.arrival_minute, rev.available_from_minute)

            present = model.NewBoolVar(f"assign_{j_idx}_{r_idx}")
            start = model.NewIntVar(earliest, horizon, f"start_{j_idx}_{r_idx}")
            end = model.NewIntVar(earliest + dur, horizon, f"end_{j_idx}_{r_idx}")
            interval = model.NewOptionalIntervalVar(start, dur, end, present, f"int_{j_idx}_{r_idx}")

            assign_vars[(j_idx, r_idx)] = present
            start_vars[(j_idx, r_idx)] = start
            end_vars[(j_idx, r_idx)] = end
            intervals_on_r.append(interval)

        model.AddNoOverlap(intervals_on_r)

    for j_idx, job in enumerate(orders):
        # Each order must be assigned to exactly one reviewer
        model.AddExactlyOne(assign_vars[(j_idx, r_idx)] for r_idx in range(len(reviewers)))

        c_j = model.NewIntVar(0, horizon, f"C_{j_idx}")
        for r_idx in range(len(reviewers)):
            model.Add(c_j == end_vars[(j_idx, r_idx)]).OnlyEnforceIf(assign_vars[(j_idx, r_idx)])
        job_end.append(c_j)

        t_j = model.NewIntVar(0, horizon, f"T_{j_idx}")
        model.Add(t_j >= c_j - job.sla_deadline_minute)
        job_tardiness.append(t_j)

    makespan = model.NewIntVar(0, horizon, "makespan")
    model.AddMaxEquality(makespan, job_end)

    # Scale weights to integers for exact CP-SAT arithmetic
    WEIGHT_SCALE = 100
    MAKESpan_LAMBDA = 10  # 0.10 weight relative to unit tardiness
    weighted_tardiness_terms = [
        int(round(orders[j_idx].priority_weight * WEIGHT_SCALE)) * job_tardiness[j_idx]
        for j_idx in range(len(orders))
    ]
    model.Minimize(sum(weighted_tardiness_terms) + MAKESpan_LAMBDA * makespan)

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 5.0
    status = solver.Solve(model)
    status_name = solver.StatusName(status)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError(f"Review scheduler CP-SAT failed with status {status_name}")

    assignments: list[ScheduledAssignment] = []
    total_weighted_tard = 0.0
    for j_idx, job in enumerate(orders):
        for r_idx, rev in enumerate(reviewers):
            if solver.BooleanValue(assign_vars[(j_idx, r_idx)]):
                s_val = solver.Value(start_vars[(j_idx, r_idx)])
                e_val = solver.Value(end_vars[(j_idx, r_idx)])
                t_val = solver.Value(job_tardiness[j_idx])
                total_weighted_tard += job.priority_weight * t_val
                assignments.append(
                    ScheduledAssignment(
                        order_id=job.order_id,
                        reviewer_id=rev.reviewer_id,
                        start_minute=s_val,
                        end_minute=e_val,
                        tardiness_minutes=t_val,
                    )
                )
                break

    assignments.sort(key=lambda a: (a.start_minute, a.order_id))

    return ScheduleReviewsResponse(
        solver_status=status_name,
        objective_value=round(solver.ObjectiveValue() / WEIGHT_SCALE, 3),
        makespan_minutes=solver.Value(makespan),
        total_weighted_tardiness=round(total_weighted_tard, 3),
        assignments=assignments,
        queueing_diagnostics=queue_diag,
    )
