"use client";

import React, { useEffect, useState } from "react";
import { Activity, AlertTriangle, Clock, Cpu, Gauge, ShieldCheck, Users } from "lucide-react";

interface QueueingDiagnostics {
  arrival_rate_per_hour: number;
  total_service_capacity_per_hour: number;
  utilization_rho: number;
  is_stable: boolean;
  littles_law_wip: number | null;
  erlang_c_wait_probability: number | null;
  expected_queue_wait_minutes: number | null;
  bottleneck_alert: string | null;
}

interface ScheduledAssignment {
  order_id: string;
  reviewer_id: string;
  start_minute: number;
  end_minute: number;
  tardiness_minutes: number;
}

interface ScheduleResponse {
  solver_status: string;
  objective_value: number;
  makespan_minutes: number;
  total_weighted_tardiness: number;
  assignments: ScheduledAssignment[];
  queueing_diagnostics: QueueingDiagnostics;
}

interface ConformalResult {
  threshold_tau: number;
  alpha_target: number;
  empirical_error_below_tau: number;
  coverage_guarantee: number;
  human_review_fraction: number;
}

const REVIEWER_NAMES: Record<string, string> = {
  "REV-KAREEM": "Kareem Adel (1.0x Speed)",
  "REV-MOHAMED": "Eng. Mohamed Sheta (1.25x Speed)",
};

export function OperationsDashboard({
  apiBase,
  activeUserId,
}: {
  apiBase: string;
  activeUserId: string;
}) {
  const [arrivalRate, setArrivalRate] = useState(14);
  const [meanService, setMeanService] = useState(7);
  const [result, setResult] = useState<ScheduleResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const [alpha, setAlpha] = useState(0.15);
  const [conformal, setConformal] = useState<ConformalResult | null>(null);

  async function runScheduler(rate = arrivalRate, svc = meanService) {
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/v1/or/schedule-reviews`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": activeUserId },
        body: JSON.stringify({
          arrival_rate_per_hour: rate,
          mean_service_minutes: svc,
          orders: [
            { order_id: "PO-2026-101", arrival_minute: 0, priority_weight: 3.0, uncertain_lines: 1, validation_warnings: 0, sla_deadline_minute: 10 },
            { order_id: "PO-2026-102", arrival_minute: 0, priority_weight: 1.5, uncertain_lines: 3, validation_warnings: 2, sla_deadline_minute: 20 },
            { order_id: "PO-2026-103", arrival_minute: 2, priority_weight: 2.5, uncertain_lines: 2, validation_warnings: 1, sla_deadline_minute: 15 },
            { order_id: "PO-2026-104", arrival_minute: 3, priority_weight: 1.0, uncertain_lines: 1, validation_warnings: 1, sla_deadline_minute: 28 },
          ],
          reviewers: [
            { reviewer_id: "REV-KAREEM", reviewer_name: "Kareem Adel", available_from_minute: 0, speed_multiplier: 1.0 },
            { reviewer_id: "REV-MOHAMED", reviewer_name: "Eng. Mohamed Sheta", available_from_minute: 0, speed_multiplier: 1.25 },
          ],
        }),
      });
      if (res.ok) setResult(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function runConformal(targetAlpha: number) {
    setAlpha(targetAlpha);
    try {
      const res = await fetch(`${apiBase}/v1/or/calibrate-conformal`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": activeUserId },
        body: JSON.stringify({
          calibration_scores: [0.02, 0.04, 0.07, 0.11, 0.14, 0.18, 0.21, 0.26, 0.34, 0.42, 0.55, 0.68, 0.81],
          calibration_is_error: [false, false, false, false, false, false, false, false, true, false, true, true, true],
          alpha: targetAlpha,
        }),
      });
      if (res.ok) setConformal(await res.json());
    } catch {
      // Ignore if offline
    }
  }

  useEffect(() => {
    runScheduler(14, 7);
    runConformal(0.15);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maxTimeline = Math.max(30, result?.makespan_minutes ?? 30);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-zinc-900">
                CP-SAT Review Scheduler & M/M/c Queueing Diagnostics
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              Parallel machine scheduling (<span className="font-mono text-zinc-700">P_m | r_j | Σ w_j T_j + λ C_max</span>) with Erlang-C and Little&apos;s Law bottleneck analytics.
            </p>
          </div>
          <button
            onClick={() => runScheduler()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            <Cpu className="h-3.5 w-3.5" />
            {loading ? "Solving..." : "Recompute Schedule"}
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-600">PO Arrival Rate (λ / hour)</span>
              <span className="font-mono font-bold text-zinc-900">{arrivalRate} PO/hr</span>
            </div>
            <input
              type="range"
              min={2}
              max={30}
              value={arrivalRate}
              onChange={(e) => {
                const v = Number(e.target.value);
                setArrivalRate(v);
                runScheduler(v, meanService);
              }}
              className="mt-2.5 w-full accent-teal-700"
            />
          </div>
          <div className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-3.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-zinc-600">Mean Review Time (minutes)</span>
              <span className="font-mono font-bold text-zinc-900">{meanService} min</span>
            </div>
            <input
              type="range"
              min={2}
              max={20}
              value={meanService}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMeanService(v);
                runScheduler(arrivalRate, v);
              }}
              className="mt-2.5 w-full accent-zinc-800"
            />
          </div>
        </div>

        {result && (
          <div className="mt-5 space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Activity className="h-3.5 w-3.5 text-teal-700" /> Utilization (ρ)
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-zinc-900">
                  {(result.queueing_diagnostics.utilization_rho * 100).toFixed(1)}%
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  {result.queueing_diagnostics.is_stable ? "Stable Queue (ρ < 1)" : "Unstable Queue (ρ ≥ 1)"}
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Clock className="h-3.5 w-3.5 text-zinc-700" /> Expected Wait (Wq)
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-zinc-900">
                  {result.queueing_diagnostics.expected_queue_wait_minutes !== null
                    ? `${result.queueing_diagnostics.expected_queue_wait_minutes} min`
                    : "∞"}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  Erlang-C P(wait):{" "}
                  <span className="font-mono">
                    {((result.queueing_diagnostics.erlang_c_wait_probability ?? 1) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Users className="h-3.5 w-3.5 text-emerald-700" /> Queue WIP (Little&apos;s L)
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-zinc-900">
                  {result.queueing_diagnostics.littles_law_wip ?? "∞"} POs
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">Average active orders in review</div>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                  <Gauge className="h-3.5 w-3.5 text-amber-700" /> Makespan / Tardiness
                </div>
                <div className="mt-1 font-mono text-xl font-bold text-zinc-900">
                  {result.makespan_minutes}m / {result.total_weighted_tardiness}
                </div>
                <div className="mt-0.5 text-[10px] font-medium text-emerald-700">Solver Status: {result.solver_status}</div>
              </div>
            </div>

            {result.queueing_diagnostics.bottleneck_alert && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" />
                <span>{result.queueing_diagnostics.bottleneck_alert}</span>
              </div>
            )}

            <div className="rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-zinc-900">Reviewer Assignment Timeline (CP-SAT Gantt)</span>
                <span className="font-mono text-[11px] text-zinc-500">0 — {maxTimeline} min</span>
              </div>
              <div className="space-y-3">
                {Object.entries(REVIEWER_NAMES).map(([revId, revLabel]) => {
                  const revTasks = result.assignments.filter((a) => a.reviewer_id === revId);
                  return (
                    <div key={revId} className="space-y-1.5">
                      <div className="text-xs font-medium text-zinc-700">{revLabel}</div>
                      <div className="relative h-9 w-full overflow-hidden rounded-lg border border-zinc-200 bg-white">
                        {revTasks.map((task) => {
                          const leftPct = (task.start_minute / maxTimeline) * 100;
                          const widthPct = Math.max(10, ((task.end_minute - task.start_minute) / maxTimeline) * 100);
                          return (
                            <div
                              key={task.order_id}
                              style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                              className={`absolute top-1 bottom-1 flex items-center justify-between rounded-md px-2 font-mono text-[11px] font-semibold text-white ${
                                task.tardiness_minutes > 0 ? "bg-rose-700" : "bg-teal-700"
                              }`}
                            >
                              <span>{task.order_id}</span>
                              <span className="text-[10px] opacity-85">
                                {task.start_minute}–{task.end_minute}m
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-700" />
              <h2 className="text-sm font-semibold text-zinc-900">
                Distribution-Free Split-Conformal Risk Calibration
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500">
              Computes threshold <span className="font-mono">τ</span> with finite-sample guarantee that Clear Match error stays below <span className="font-mono">α</span>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[0.05, 0.1, 0.15, 0.25].map((preset) => (
              <button
                key={preset}
                onClick={() => runConformal(preset)}
                className={`rounded-lg px-3 py-1.5 font-mono text-xs transition ${
                  alpha === preset
                    ? "bg-zinc-900 text-white"
                    : "border border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100"
                }`}
              >
                α = {(preset * 100).toFixed(0)}%
              </button>
            ))}
          </div>
        </div>

        {conformal && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5">
              <div className="text-[11px] text-zinc-500">Calibrated Threshold (τ)</div>
              <div className="mt-1 font-mono text-lg font-bold text-teal-800">
                {conformal.threshold_tau.toFixed(3)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5">
              <div className="text-[11px] text-zinc-500">Coverage Guarantee (1 - α)</div>
              <div className="mt-1 font-mono text-lg font-bold text-zinc-900">
                {(conformal.coverage_guarantee * 100).toFixed(1)}%
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5">
              <div className="text-[11px] text-zinc-500">Empirical Error Below τ</div>
              <div className="mt-1 font-mono text-lg font-bold text-emerald-800">
                {(conformal.empirical_error_below_tau * 100).toFixed(2)}%
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3.5">
              <div className="text-[11px] text-zinc-500">Human Review Rate</div>
              <div className="mt-1 font-mono text-lg font-bold text-amber-800">
                {(conformal.human_review_fraction * 100).toFixed(1)}%
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
