"use client";

import React, { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Cpu, Factory, Layers, TrendingUp, Upload } from "lucide-react";
import { OrvexaLogo } from "./OrvexaLogo";

interface SkuPolicy {
  sku: string;
  name_ar: string;
  abc_class: "A" | "B" | "C";
  xyz_class: "X" | "Y" | "Z";
  annual_revenue_egp: number;
  safety_stock_units: number;
  reorder_point_s: number;
  eoq_units: number;
  current_stock_units: number;
  recommended_replenish_units: number;
  stockout_risk_flag: boolean;
}

interface ResourceBottleneck {
  resource_id: string;
  resource_name_ar: string;
  available_hours: number;
  used_hours: number;
  slack_hours: number;
  utilization_pct: number;
  is_bottleneck: boolean;
  shadow_price_egp_per_hour: number;
}

interface CapacityPlanItem {
  sku: string;
  horizon_demand_units: number;
  optimal_fulfill_units: number;
  fulfillment_pct: number;
  margin_contribution_egp: number;
}

interface MultiPeriodLot {
  period_week: number;
  sku: string;
  demand_units: number;
  produce_units: number;
  setup_triggered: boolean;
  ending_inventory_units: number;
}

interface BottleneckWhatIf {
  resource_id: string;
  resource_name_ar: string;
  added_hours: number;
  margin_gain_egp: number;
  new_total_margin_egp: number;
}

interface AnalyzeResponse {
  organization_name: string;
  solver_backend: string;
  solve_time_ms: number;
  optimal_total_margin_egp: number;
  total_working_capital_required_egp: number;
  sku_policies: SkuPolicy[];
  resource_bottlenecks: ResourceBottleneck[];
  capacity_plan: CapacityPlanItem[];
  multi_period_clsp?: MultiPeriodLot[];
  clsp_total_net_profit_egp?: number;
  what_if_expansions?: BottleneckWhatIf[];
  po_audit: {
    orders_analyzed: number;
    total_lines_extracted: number;
    matched_lines: number;
    exact_packaging_lines: number;
    packaging_rounding_delta_units: number;
  };
}

export function EnterpriseDiagnosticsView({
  apiBase,
  activeUserId,
  activeOrgId,
  activeOrgName,
}: {
  apiBase: string;
  activeUserId: string;
  activeOrgId: string;
  activeOrgName: string;
}) {
  const [budgetCap, setBudgetCap] = useState<string>("");
  const [data, setData] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const runAnalysis = useCallback(
    async (customPayload?: Record<string, unknown>) => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`${apiBase}/v1/enterprise/analyze`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-user-id": activeUserId,
            "x-org-id": activeOrgId,
          },
          body: JSON.stringify({
            workingCapitalBudgetEgp: budgetCap ? Number(budgetCap) : null,
            customPayload,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Enterprise OR diagnostics failed");
        setData(json);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Unable to connect to OR engine");
      } finally {
        setLoading(false);
      }
    },
    [apiBase, activeUserId, activeOrgId, budgetCap]
  );

  useEffect(() => {
    runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  async function handleErpJsonUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      await runAnalysis(parsed);
    } catch {
      setErr("Invalid JSON file — please verify ERP export schema.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-3.5">
          <OrvexaLogo compact />
          <div>
            <h2 className="text-sm font-bold text-zinc-900">
              Enterprise Operations Research Diagnostics ({activeOrgName})
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Plugs directly into company ERP data to solve Capacity LP (<span className="font-mono">GLOP + Dual Shadow Prices</span>), 4-Week Lot-Sizing (<span className="font-mono">HiGHS CLSP MILP</span>), Stochastic <span className="font-mono">(s, S) & EOQ</span>, and <span className="font-mono">ABC-XYZ</span>.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <input
            type="number"
            min={1000}
            value={budgetCap}
            onChange={(e) => setBudgetCap(e.target.value)}
            placeholder="Working Capital Cap (EGP)"
            className="w-52 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-teal-700 focus:bg-white focus:outline-none"
          />
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
            <Upload className="h-3.5 w-3.5 text-teal-700" />
            <span>Upload ERP JSON</span>
            <input type="file" accept=".json" onChange={handleErpJsonUpload} className="hidden" />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => runAnalysis()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            <Cpu className="h-3.5 w-3.5" />
            {loading ? "Solving Models..." : "Run Enterprise OR Suite"}
          </button>
        </div>
      </section>

      {err && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-800">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <TrendingUp className="h-4 w-4 text-teal-700" /> Optimal Margin (LP)
              </div>
              <div className="mt-1.5 font-mono text-2xl font-bold text-zinc-900">
                {data.optimal_total_margin_egp.toLocaleString("en-US", { minimumFractionDigits: 0 })} EGP
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">Achieved under current plant capacities</div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Layers className="h-4 w-4 text-zinc-700" /> Replenishment Capital
              </div>
              <div className="mt-1.5 font-mono text-2xl font-bold text-zinc-900">
                {data.total_working_capital_required_egp.toLocaleString("en-US", { minimumFractionDigits: 0 })} EGP
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">Required to restore SKUs below reorder point</div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" /> Historical PO MILP Audit
              </div>
              <div className="mt-1.5 font-mono text-2xl font-bold text-zinc-900">
                {data.po_audit.matched_lines}/{data.po_audit.total_lines_extracted} lines
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">
                Across {data.po_audit.orders_analyzed} POs — Exact packs: {data.po_audit.exact_packaging_lines}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Cpu className="h-4 w-4 text-zinc-700" /> Solver & Latency
              </div>
              <div className="mt-1.5 font-mono text-2xl font-bold text-teal-800">{data.solve_time_ms} ms</div>
              <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">{data.solver_backend}</div>
            </div>
          </div>

          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3">
              <Factory className="h-4 w-4 text-teal-700" />
              <h3 className="text-sm font-semibold text-zinc-900">
                Plant Resource Bottlenecks & LP Dual Shadow Prices
              </h3>
            </div>

            {data.resource_bottlenecks.length === 0 ? (
              <p className="text-xs text-zinc-500">No plant capacity constraints configured for this organization yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {data.resource_bottlenecks.map((rb) => (
                  <div
                    key={rb.resource_id}
                    className={`rounded-xl border p-4 ${
                      rb.is_bottleneck ? "border-amber-300 bg-amber-50/40" : "border-zinc-200 bg-zinc-50/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold text-zinc-900">{rb.resource_name_ar}</div>
                        <div className="font-mono text-[10px] text-zinc-500">{rb.resource_id}</div>
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                          rb.is_bottleneck
                            ? "border-amber-300 bg-amber-100 text-amber-900"
                            : "border-emerald-200 bg-emerald-50 text-emerald-800"
                        }`}
                      >
                        {rb.is_bottleneck ? "Binding Bottleneck" : "Available Slack"}
                      </span>
                    </div>

                    <div className="mt-3">
                      <div className="mb-1 flex justify-between text-[11px] text-zinc-600">
                        <span>Used: {rb.used_hours} / {rb.available_hours} hrs</span>
                        <span className="font-mono font-bold">{rb.utilization_pct}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200">
                        <div
                          style={{ width: `${Math.min(100, rb.utilization_pct)}%` }}
                          className={`h-full rounded-full ${rb.is_bottleneck ? "bg-amber-600" : "bg-teal-700"}`}
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-zinc-200/70 pt-2.5 text-xs">
                      <span className="text-zinc-500">Dual Shadow Price:</span>
                      <span className="font-mono font-bold text-zinc-900">
                        +{rb.shadow_price_egp_per_hour.toLocaleString("en-US")} EGP/hr
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs xl:col-span-5">
              <h3 className="mb-3 border-b border-zinc-100 pb-2.5 text-sm font-semibold text-zinc-900">
                Optimal Fulfillment Plan (Capacity LP)
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 text-zinc-500">
                    <tr>
                      <th className="py-2">SKU</th>
                      <th className="py-2">Demand</th>
                      <th className="py-2">Optimal</th>
                      <th className="py-2">Fill %</th>
                      <th className="py-2">Margin (EGP)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.capacity_plan.map((cp) => (
                      <tr key={cp.sku}>
                        <td className="py-2.5 font-mono font-semibold text-zinc-900">{cp.sku}</td>
                        <td className="py-2.5 font-mono text-zinc-600">{cp.horizon_demand_units}</td>
                        <td className="py-2.5 font-mono font-semibold text-teal-800">{cp.optimal_fulfill_units}</td>
                        <td className="py-2.5 font-mono">{cp.fulfillment_pct}%</td>
                        <td className="py-2.5 font-mono text-zinc-800">
                          {cp.margin_contribution_egp.toLocaleString("en-US")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs xl:col-span-7">
              <h3 className="mb-3 border-b border-zinc-100 pb-2.5 text-sm font-semibold text-zinc-900">
                Inventory Policy: ABC-XYZ, Safety Stock, Reorder Point & EOQ
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-zinc-200 text-zinc-500">
                    <tr>
                      <th className="py-2">Product</th>
                      <th className="py-2">Class</th>
                      <th className="py-2">Safety Stock</th>
                      <th className="py-2">ROP (s)</th>
                      <th className="py-2">EOQ (Q*)</th>
                      <th className="py-2">On Hand</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {data.sku_policies.map((sp) => (
                      <tr key={sp.sku}>
                        <td className="py-2.5">
                          <div className="font-semibold text-zinc-900">{sp.name_ar}</div>
                          <div className="font-mono text-[10px] text-zinc-500">{sp.sku}</div>
                        </td>
                        <td className="py-2.5 font-mono font-bold">
                          <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-zinc-800">
                            {sp.abc_class}{sp.xyz_class}
                          </span>
                        </td>
                        <td className="py-2.5 font-mono text-zinc-700">{sp.safety_stock_units}</td>
                        <td className="py-2.5 font-mono text-zinc-700">{sp.reorder_point_s}</td>
                        <td className="py-2.5 font-mono font-semibold text-teal-800">{sp.eoq_units}</td>
                        <td className="py-2.5 font-mono">{sp.current_stock_units}</td>
                        <td className="py-2.5">
                          {sp.stockout_risk_flag ? (
                            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-800">
                              Order {sp.recommended_replenish_units}
                            </span>
                          ) : (
                            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                              Healthy
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
            {data.what_if_expansions && data.what_if_expansions.length > 0 && (
              <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs xl:col-span-4">
                <h3 className="mb-3 border-b border-zinc-100 pb-2.5 text-sm font-semibold text-zinc-900">
                  What-If Sensitivity (+20% Bottleneck Expansion)
                </h3>
                <div className="space-y-3">
                  {data.what_if_expansions.map((w) => (
                    <div key={w.resource_id} className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
                      <div className="text-xs font-bold text-zinc-900">{w.resource_name_ar}</div>
                      <div className="mt-1 text-[11px] text-zinc-600">
                        Adding <span className="font-mono font-semibold">{w.added_hours} hrs</span> capacity
                      </div>
                      <div className="mt-2.5 flex items-baseline justify-between border-t border-emerald-200/70 pt-2">
                        <span className="text-[11px] text-zinc-600">Net Margin Gain:</span>
                        <span className="font-mono text-sm font-bold text-emerald-800">
                          +{w.margin_gain_egp.toLocaleString("en-US")} EGP
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {data.multi_period_clsp && data.multi_period_clsp.length > 0 && (
              <section
                className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs ${
                  data.what_if_expansions && data.what_if_expansions.length > 0 ? "xl:col-span-8" : "xl:col-span-12"
                }`}
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-2.5">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    4-Week Capacitated Lot-Sizing Schedule (CLSP MILP)
                  </h3>
                  {data.clsp_total_net_profit_egp != null && (
                    <span className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-mono text-xs font-bold text-teal-800">
                      Net CLSP Profit: {data.clsp_total_net_profit_egp.toLocaleString("en-US")} EGP
                    </span>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 border-b border-zinc-200 bg-white text-zinc-500">
                      <tr>
                        <th className="py-2">Week</th>
                        <th className="py-2">SKU</th>
                        <th className="py-2">Demand</th>
                        <th className="py-2">Produce</th>
                        <th className="py-2">Line Setup</th>
                        <th className="py-2">Ending Inv.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {data.multi_period_clsp.map((lot, idx) => (
                        <tr key={idx}>
                          <td className="py-2 font-mono text-zinc-600">W{lot.period_week}</td>
                          <td className="py-2 font-mono font-semibold text-zinc-900">{lot.sku}</td>
                          <td className="py-2 font-mono">{lot.demand_units}</td>
                          <td className="py-2 font-mono font-semibold text-teal-800">{lot.produce_units}</td>
                          <td className="py-2">
                            {lot.setup_triggered ? (
                              <span className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-800">
                                Setup Active
                              </span>
                            ) : (
                              <span className="text-[10px] text-zinc-400">—</span>
                            )}
                          </td>
                          <td className="py-2 font-mono text-zinc-700">{lot.ending_inventory_units}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
