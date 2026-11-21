"use client";

import React, { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Gauge,
  Lock,
  Package,
  Plus,
  RefreshCw,
  ShieldAlert,
  Upload,
  UserCheck,
  XCircle,
} from "lucide-react";
import type { CatalogProductView, CustomerView } from "./CatalogView";
import { OrvexaLogo } from "./OrvexaLogo";

export interface PackagingPlanItem {
  unit_code: string;
  unit_label_ar: string;
  count: number;
  base_units_subtotal: number;
}

export interface PackagingSolution {
  requested_base_units: number;
  allocated_base_units: number;
  surplus_base_units: number;
  deficit_base_units: number;
  is_exact: boolean;
  meets_moq: boolean;
  plan: PackagingPlanItem[];
  explanation: string;
  explanation_ar?: string;
}

export interface CandidateMatchOption {
  product_id: string;
  sku: string;
  name_ar: string;
  name_en: string;
  mismatch_cost: number;
  reasons: string[];
}

export interface MatchedOrderLine {
  line_number: number;
  extracted: {
    line_number: number;
    raw_description: string;
    normalized_description: string;
    source_span_start: number;
    source_span_end: number;
    extracted_quantity: number | null;
    extracted_unit: string | null;
    explicit_sku: string | null;
    extraction_ambiguities: string[];
  };
  matching_outcome: "clear_match" | "possible_match" | "multiple_matches" | "no_match" | "conflicting";
  assigned_product_id: string | null;
  assigned_sku: string | null;
  assigned_name_ar?: string | null;
  assigned_name_en?: string | null;
  unit_price_base?: number | null;
  line_subtotal?: number | null;
  mismatch_cost: number | null;
  alternatives: CandidateMatchOption[];
  packaging_solution: PackagingSolution | null;
  requires_human_confirmation: boolean;
  is_human_confirmed?: boolean;
}

export interface ValidationRuleResult {
  rule_code: string;
  status: "passed" | "warning" | "failed" | "requires_human_review" | "not_applicable";
  is_in_mus: boolean;
  message: string;
  message_ar?: string;
  suggested_repair: string | null;
  suggested_repair_ar?: string | null;
}

export interface OrAnalysis {
  model_disclaimer: string;
  overall_feasible: boolean;
  recommended_status: "needs_review" | "needs_clarification";
  detected_customer_hint?: string | null;
  header_notes?: string[];
  estimated_order_total?: number | null;
  currency?: string;
  lines: MatchedOrderLine[];
  validation_results: ValidationRuleResult[];
  mus_conflicts: string[];
  or_solver_metadata: {
    matching_model: string;
    packaging_model: string;
    validation_model: string;
    solve_time_ms: number;
  };
}

export interface OrderRecord {
  id: string;
  rawText: string;
  sourceChannel?: string;
  customerId: string | null;
  status: string;
  orAnalysis: OrAnalysis;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

const SEWEDY_FEEDS = [
  {
    title: "CSV ERP Purchase Order — El Sewedy Electric",
    channel: "erp_csv_feed",
    customerId: "33333333-3333-3333-3333-333333333301",
    text: `SKU,Description,Quantity,Unit
CBL-SWD-3X16-100M,El Sewedy Copper Cable 3x16,3,reel
ABB-MCB-63A,ABB 3-Pole Circuit Breaker 63A,18,unit
OIL-TRN-200L,Transformer Insulating Oil 200L,2,pallet`,
  },
  {
    title: "Project PO Email — Hassan Allam Engineering",
    channel: "email_po",
    customerId: "33333333-3333-3333-3333-333333333302",
    text: `Purchase Order for New Capital Site:
4 reel elsewedy 3x16
3 carton abb 63a
1 drum transformer oil`,
  },
  {
    title: "Incomplete PO (Test CP-SAT + MUS Conflicts)",
    channel: "document_intake",
    customerId: "",
    text: `Urgent supply request:
2 carton abb 63a
5 unit Unregistered Custom Switchgear Item`,
  },
];

const MOBICA_FEEDS = [
  {
    title: "CSV Project PO — Commercial International Bank (CIB)",
    channel: "erp_csv_feed",
    customerId: "33333333-3333-3333-3333-333333333303",
    text: `SKU,Description,Quantity,Unit
MOB-EXEC-DESK,Mobica Executive Desk 200cm,8,unit
MOB-ERG-CHAIR,Mobica Ergonomic Mesh Chair,15,unit
MOB-WRK-STN4,Mobica 4-Person Acoustic Workstation,4,unit`,
  },
  {
    title: "Corporate Fit-Out PO — Vodafone Egypt HQ",
    channel: "email_po",
    customerId: "33333333-3333-3333-3333-333333333304",
    text: `Smart Village Building C2 Fit-Out:
10 carton mobica mesh chair
3 unit workstation 4`,
  },
];

const STATUS_META: Record<string, { label: string; dot: string; pill: string }> = {
  needs_review: { label: "Needs Review", dot: "bg-teal-600", pill: "border-teal-200 bg-teal-50 text-teal-800" },
  needs_clarification: { label: "Needs Clarification", dot: "bg-amber-600", pill: "border-amber-200 bg-amber-50 text-amber-800" },
  draft: { label: "Draft", dot: "bg-zinc-500", pill: "border-zinc-200 bg-zinc-100 text-zinc-700" },
  approved: { label: "Approved", dot: "bg-emerald-600", pill: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  rejected: { label: "Rejected", dot: "bg-rose-600", pill: "border-rose-200 bg-rose-50 text-rose-800" },
};

const OUTCOME_BADGE: Record<MatchedOrderLine["matching_outcome"], { label: string; cls: string }> = {
  clear_match: { label: "Clear Match", cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  possible_match: { label: "Possible Match", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  multiple_matches: { label: "Multiple Matches", cls: "border-zinc-300 bg-zinc-100 text-zinc-800" },
  no_match: { label: "No Match", cls: "border-rose-200 bg-rose-50 text-rose-800" },
  conflicting: { label: "Unit Conflict", cls: "border-rose-200 bg-rose-50 text-rose-800" },
};

export function SplitWorkbench({
  apiBase,
  activeUserId,
  activeOrgId,
  canApproveOrders,
  customers,
  products,
  orders,
  onOrderCreatedOrUpdated,
}: {
  apiBase: string;
  activeUserId: string;
  activeOrgId: string;
  canApproveOrders: boolean;
  customers: CustomerView[];
  products: CatalogProductView[];
  orders: OrderRecord[];
  onOrderCreatedOrUpdated: () => Promise<void>;
}) {
  const presets = activeOrgId.endsWith("1112") ? MOBICA_FEEDS : SEWEDY_FEEDS;
  const [composerOpen, setComposerOpen] = useState(orders.length === 0);
  const [rawText, setRawText] = useState(presets[0].text);
  const [customerId, setCustomerId] = useState<string>(customers[0]?.id ?? "");
  const [sourceChannel, setSourceChannel] = useState<string>(presets[0].channel);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [hoveredSpan, setHoveredSpan] = useState<[number, number] | null>(null);
  const [rationale, setRationale] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [ctpResult, setCtpResult] = useState<{
    feasible_within_standard_capacity: boolean;
    feasible_with_overtime: boolean;
    total_overtime_hours_needed: number;
    overtime_by_resource_ar: Record<string, number>;
    estimated_lead_days: number;
  } | null>(null);
  const [editingQty, setEditingQty] = useState<Record<number, string>>({});

  const activeOrder = orders.find((o) => o.id === selectedOrderId) ?? orders[0] ?? null;
  const activeCustomer = customers.find((c) => c.id === activeOrder?.customerId);
  const isFinalized = activeOrder?.status === "approved" || activeOrder?.status === "rejected";

  async function submitPO(textToSend = rawText, custToSend = customerId, channel = sourceChannel) {
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);
    setCtpResult(null);
    try {
      const res = await fetch(`${apiBase}/v1/orders/intake`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": activeUserId,
          "x-org-id": activeOrgId,
        },
        body: JSON.stringify({
          rawText: textToSend,
          customerId: custToSend || null,
          sourceChannel: channel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to process Purchase Order");
      setSelectedOrderId(data.order.id);
      setComposerOpen(false);
      await onOrderCreatedOrUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  async function handleFileIntake(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setRawText(text);
    setSourceChannel("uploaded_po_file");
    await submitPO(text, customerId || customers[0]?.id || "", "uploaded_po_file");
  }

  async function patchOrderLine(
    lineNumber: number,
    patch: {
      confirmedProductId?: string;
      confirmedQuantity?: number;
      confirmedUnit?: string;
      isHumanConfirmed?: boolean;
    }
  ) {
    if (!activeOrder || isFinalized) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${apiBase}/v1/orders/${activeOrder.id}/lines`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": activeUserId,
          "x-org-id": activeOrgId,
        },
        body: JSON.stringify({ lineNumber, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update line");
      await onOrderCreatedOrUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Update failed");
    } finally {
      setLoading(false);
    }
  }

  async function assignCustomer(newCustomerId: string) {
    if (!activeOrder || !newCustomerId || isFinalized) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${apiBase}/v1/orders/${activeOrder.id}/customer`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": activeUserId,
          "x-org-id": activeOrgId,
        },
        body: JSON.stringify({ customerId: newCustomerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to assign customer");
      await onOrderCreatedOrUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Customer assignment failed");
    } finally {
      setLoading(false);
    }
  }

  async function saveLearnedAlias(productId: string, rawDescription: string) {
    setLoading(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      const res = await fetch(`${apiBase}/v1/products/${productId}/aliases`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": activeUserId,
          "x-org-id": activeOrgId,
        },
        body: JSON.stringify({ aliasText: rawDescription }),
      });
      if (!res.ok) throw new Error("Failed to save alias");
      setInfoMsg(`Saved "${rawDescription}" as a verified catalog alias for future Purchase Orders.`);
      await onOrderCreatedOrUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function runOrderCtpCheck() {
    if (!activeOrder) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${apiBase}/v1/orders/${activeOrder.id}/check-ctp`, {
        method: "POST",
        headers: { "x-user-id": activeUserId, "x-org-id": activeOrgId },
      });
      if (!res.ok) throw new Error("Failed to run Capable-to-Promise check");
      setCtpResult(await res.json());
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  function exportApprovedCsv() {
    if (!activeOrder) return;
    const rows = [
      ["SKU", "Product", "Quantity", "Unit", "Allocated_Base_Units", "Subtotal_EGP"],
      ...activeOrder.orAnalysis.lines.map((l) => [
        l.assigned_sku ?? "",
        l.assigned_name_en ?? l.assigned_name_ar ?? "",
        String(l.extracted.extracted_quantity ?? ""),
        l.extracted.extracted_unit ?? "",
        String(l.packaging_solution?.allocated_base_units ?? ""),
        String(l.line_subtotal ?? ""),
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ORVEXA-PO-${activeOrder.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDecision(decision: "approved" | "rejected" | "request_clarification" | "save_draft") {
    if (!activeOrder) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${apiBase}/v1/orders/${activeOrder.id}/decide`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": activeUserId,
          "x-org-id": activeOrgId,
        },
        body: JSON.stringify({ decision, rationale: rationale || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Decision failed");
      setRationale("");
      await onOrderCreatedOrUpdated();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Error executing decision");
    } finally {
      setLoading(false);
    }
  }

  function renderHighlightedSource(text: string) {
    if (!hoveredSpan) {
      return <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-zinc-700">{text}</pre>;
    }
    const [start, end] = hoveredSpan;
    return (
      <pre className="whitespace-pre-wrap font-mono text-xs leading-6 text-zinc-400">
        {text.slice(0, start)}
        <mark className="rounded bg-amber-200/80 px-1 py-0.5 text-zinc-950 ring-1 ring-amber-400">
          {text.slice(start, end)}
        </mark>
        {text.slice(end)}
      </pre>
    );
  }

  const pipelineStages = [
    { label: "1. PO Intake", done: true },
    { label: "2. Extraction", done: true },
    { label: "3. MILP Match", done: true },
    { label: "4. MILP Pack", done: true },
    { label: "5. CP-SAT Valid", done: Boolean(activeOrder?.orAnalysis.overall_feasible) },
    { label: "6. Human Approved", done: activeOrder?.status === "approved" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setComposerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-zinc-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            {composerOpen ? "Hide Intake Panel" : "New PO Intake"}
          </button>

          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100">
            <Upload className="h-3.5 w-3.5 text-teal-700" />
            <span>Upload PO File (CSV / TXT)</span>
            <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileIntake} className="hidden" />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium text-zinc-500">Enterprise Feed Presets:</span>
          {presets.map((sc, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setRawText(sc.text);
                setCustomerId(sc.customerId);
                setSourceChannel(sc.channel);
                submitPO(sc.text, sc.customerId, sc.channel);
              }}
              className="rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-100"
            >
              {sc.title}
            </button>
          ))}
        </div>
      </div>

      {composerOpen && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitPO();
          }}
          className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-zinc-900">Purchase Order Ingestion (CSV / ERP Feed / Email)</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-800 focus:border-teal-700 focus:outline-none"
              >
                <option value="">-- Unassigned Customer --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-teal-700 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
              >
                {loading ? "Running OR Solvers..." : "Analyze & Optimize PO"}
              </button>
            </div>
          </div>
          <textarea
            rows={4}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste CSV purchase order rows or unstructured order text..."
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 font-mono text-xs leading-6 text-zinc-900 placeholder:text-zinc-400 focus:border-teal-700 focus:bg-white focus:outline-none"
          />
        </form>
      )}

      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-medium text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{errorMsg}</span>
        </div>
      )}
      {infoMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
          <span>{infoMsg}</span>
        </div>
      )}

      {activeOrder ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
          <aside className="space-y-2 xl:col-span-2">
            <div className="px-1 text-[11px] font-semibold text-zinc-500">
              Purchase Orders ({orders.length})
            </div>
            <div className="space-y-2">
              {orders.map((ord) => {
                const st = STATUS_META[ord.status] ?? STATUS_META.needs_review;
                const cust = customers.find((c) => c.id === ord.customerId);
                const selected = ord.id === activeOrder.id;
                return (
                  <button
                    key={ord.id}
                    type="button"
                    onClick={() => {
                      setSelectedOrderId(ord.id);
                      setCtpResult(null);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected
                        ? "border-zinc-900 bg-white shadow-sm ring-1 ring-zinc-900/10"
                        : "border-zinc-200 bg-white/70 hover:border-zinc-300 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${st.pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {ord.orAnalysis.lines.length}L
                      </span>
                    </div>
                    <div className="mt-2 truncate text-xs font-semibold text-zinc-900">
                      {cust?.company_name ?? "Unidentified Customer"}
                    </div>
                    {ord.orAnalysis.estimated_order_total != null && (
                      <div className="mt-1 font-mono text-[11px] font-semibold text-teal-800">
                        {ord.orAnalysis.estimated_order_total.toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="space-y-4 xl:col-span-6">
            <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-xs">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {pipelineStages.map((st, idx) => (
                  <div
                    key={idx}
                    className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-medium ${
                      st.done
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-zinc-200 bg-zinc-50 text-zinc-500"
                    }`}
                  >
                    {st.done && <Check className="h-3 w-3 shrink-0" />}
                    <span>{st.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <UserCheck className="h-4 w-4 text-teal-700" />
                    {activeCustomer ? (
                      <span className="text-sm font-bold text-zinc-900">{activeCustomer.company_name}</span>
                    ) : (
                      <select
                        defaultValue=""
                        onChange={(e) => assignCustomer(e.target.value)}
                        className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 focus:outline-none"
                      >
                        <option value="" disabled>
                          Assign Customer ({activeOrder.orAnalysis.detected_customer_hint ? `Hint: ${activeOrder.orAnalysis.detected_customer_hint}` : "Required"})
                        </option>
                        {customers.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.company_name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  {activeCustomer && (
                    <p className="text-xs text-zinc-500">Delivery Site: {activeCustomer.delivery_address}</p>
                  )}
                </div>

                <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-right">
                  <div className="text-[10px] text-zinc-500">Estimated PO Total (Catalog Pricing)</div>
                  <div className="font-mono text-lg font-bold text-zinc-900">
                    {activeOrder.orAnalysis.estimated_order_total != null
                      ? `${activeOrder.orAnalysis.estimated_order_total.toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP`
                      : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h3 className="text-xs font-semibold text-zinc-700">
                  Structured Candidate Lines ({activeOrder.orAnalysis.lines.length} items)
                </h3>
                <span className="font-mono text-[11px] text-zinc-500">
                  OR Solve: {activeOrder.orAnalysis.or_solver_metadata.solve_time_ms} ms
                </span>
              </div>

              {activeOrder.orAnalysis.lines.map((line) => {
                const badge = OUTCOME_BADGE[line.matching_outcome];
                const matchedProd = products.find((p) => p.id === line.assigned_product_id);
                const qtyDraft = editingQty[line.line_number] ?? String(line.extracted.extracted_quantity ?? "");

                return (
                  <div
                    key={line.line_number}
                    onMouseEnter={() =>
                      setHoveredSpan([line.extracted.source_span_start, line.extracted.source_span_end])
                    }
                    onMouseLeave={() => setHoveredSpan(null)}
                    className={`rounded-2xl border p-4 shadow-xs transition ${
                      line.is_human_confirmed
                        ? "border-emerald-300 bg-emerald-50/25"
                        : "border-zinc-200 bg-white hover:border-zinc-300"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700">
                            #{line.line_number}
                          </span>
                          <span className="text-zinc-500">Raw Source:</span>
                          <span className="font-medium text-zinc-800">&ldquo;{line.extracted.raw_description}&rdquo;</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 pt-0.5">
                          {line.assigned_sku ? (
                            <>
                              <span className="rounded border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-xs font-semibold text-zinc-900">
                                {line.assigned_sku}
                              </span>
                              <span className="text-sm font-bold text-zinc-900">
                                {line.assigned_name_en ?? matchedProd?.name_en ?? line.assigned_name_ar}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs font-semibold text-rose-700">
                              Unmatched — select a catalog SKU below
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {line.is_human_confirmed && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                            <CheckCircle2 className="h-3 w-3" /> Confirmed
                          </span>
                        )}
                        <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-zinc-500">Qty:</span>
                        <input
                          type="number"
                          step="any"
                          disabled={isFinalized || loading}
                          value={qtyDraft}
                          onChange={(e) =>
                            setEditingQty((prev) => ({ ...prev, [line.line_number]: e.target.value }))
                          }
                          className="w-20 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-center font-mono text-xs text-zinc-900 focus:border-teal-700 focus:outline-none disabled:opacity-50"
                        />
                        <select
                          disabled={isFinalized || loading}
                          value={line.extracted.extracted_unit ?? ""}
                          onChange={(e) =>
                            patchOrderLine(line.line_number, {
                              confirmedUnit: e.target.value,
                              confirmedQuantity: Number(qtyDraft) || line.extracted.extracted_quantity || 1,
                              isHumanConfirmed: true,
                            })
                          }
                          className="rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-800 focus:outline-none disabled:opacity-50"
                        >
                          <option value="">Unspecified Unit</option>
                          <option value="pallet">Pallet</option>
                          <option value="reel">Reel</option>
                          <option value="drum">Drum</option>
                          <option value="carton">Carton</option>
                          <option value="box">Box</option>
                          <option value="pack">Pack</option>
                          <option value="unit">Unit</option>
                          <option value="meter">Meter</option>
                        </select>
                        {!isFinalized && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              patchOrderLine(line.line_number, {
                                confirmedQuantity: Number(qtyDraft) || 1,
                                isHumanConfirmed: true,
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-zinc-800 transition hover:bg-zinc-100"
                          >
                            <RefreshCw className="h-3 w-3" /> Confirm &amp; Re-Solve
                          </button>
                        )}
                      </div>

                      {line.line_subtotal != null && (
                        <div className="font-mono text-xs font-bold text-teal-800">
                          {line.line_subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP
                        </div>
                      )}
                    </div>

                    {line.packaging_solution && (
                      <div
                        className={`mt-2.5 rounded-xl border p-3 text-xs ${
                          line.packaging_solution.is_exact
                            ? "border-emerald-200 bg-emerald-50/60"
                            : "border-amber-200 bg-amber-50/70"
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 font-medium text-zinc-800">
                            <Package className="h-3.5 w-3.5 text-teal-700" />
                            Integer Packaging MILP:
                          </span>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {line.packaging_solution.plan.map((p, idx) => (
                              <span key={idx} className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-zinc-900">
                                {p.count} × {p.unit_code} ({p.base_units_subtotal} base units)
                              </span>
                            ))}
                          </div>
                        </div>

                        {!line.packaging_solution.is_exact && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 pt-2">
                            <p className="text-[11px] text-amber-900">{line.packaging_solution.explanation}</p>
                            {!isFinalized && line.packaging_solution.plan[0] && (
                              <button
                                type="button"
                                disabled={loading}
                                onClick={() =>
                                  patchOrderLine(line.line_number, {
                                    confirmedQuantity: line.packaging_solution!.plan[0].count,
                                    confirmedUnit: line.packaging_solution!.plan[0].unit_code,
                                    isHumanConfirmed: true,
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 transition hover:bg-amber-100"
                              >
                                <ArrowRight className="h-3 w-3" /> Snap to {line.packaging_solution.plan[0].count} ×{" "}
                                {line.packaging_solution.plan[0].unit_code}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {line.alternatives.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                        <span className="text-zinc-500">Catalog Alternatives:</span>
                        {line.alternatives.map((alt) => {
                          const isCurrent = alt.product_id === line.assigned_product_id;
                          return (
                            <button
                              key={alt.product_id}
                              type="button"
                              disabled={isFinalized || loading}
                              onClick={() =>
                                patchOrderLine(line.line_number, {
                                  confirmedProductId: alt.product_id,
                                  isHumanConfirmed: true,
                                })
                              }
                              className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 transition disabled:opacity-50 ${
                                isCurrent
                                  ? "border-zinc-900 bg-zinc-900 text-white"
                                  : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100"
                              }`}
                            >
                              <span className="font-mono text-[10px]">{alt.sku}</span>
                              <span>{alt.name_en}</span>
                            </button>
                          );
                        })}
                        {line.assigned_product_id && !isFinalized && (
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              saveLearnedAlias(line.assigned_product_id!, line.extracted.normalized_description)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2 py-1 text-[10px] font-semibold text-teal-800 hover:bg-teal-100"
                          >
                            <BookmarkPlus className="h-3 w-3" /> Save Verified Alias
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <aside className="space-y-4 xl:col-span-4">
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="mb-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-zinc-700" />
                  <h3 className="text-xs font-semibold text-zinc-900">Immutable Source Document</h3>
                </div>
                <span className="text-[10px] text-zinc-400">Provenance Linked</span>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3.5">
                {renderHighlightedSource(activeOrder.rawText)}
              </div>
              {activeOrder.orAnalysis.header_notes && activeOrder.orAnalysis.header_notes.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                  <span>Excluded Header Context:</span>
                  {activeOrder.orAnalysis.header_notes.map((h, idx) => (
                    <span key={idx} className="rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-700">
                      {h}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-700" />
                  <h3 className="text-xs font-semibold text-zinc-900">CP-SAT Validation &amp; MUS Core</h3>
                </div>
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                    activeOrder.orAnalysis.overall_feasible
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-rose-200 bg-rose-50 text-rose-800"
                  }`}
                >
                  {activeOrder.orAnalysis.overall_feasible ? "Feasible" : "Infeasible"}
                </span>
              </div>

              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {activeOrder.orAnalysis.validation_results.map((vr, idx) => (
                  <div
                    key={idx}
                    className={`rounded-xl border p-2.5 text-xs ${
                      vr.is_in_mus
                        ? "border-rose-300 bg-rose-50"
                        : vr.status === "passed"
                        ? "border-zinc-200 bg-zinc-50/70"
                        : "border-amber-200 bg-amber-50/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] font-semibold text-zinc-700">{vr.rule_code}</span>
                      {vr.is_in_mus ? (
                        <span className="rounded bg-rose-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-800">
                          MUS Core
                        </span>
                      ) : vr.status === "passed" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-700" />
                      )}
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-zinc-700">{vr.message}</p>
                    {vr.suggested_repair && (
                      <p className="mt-0.5 text-[11px] font-medium text-teal-800">
                        Repair: {vr.suggested_repair}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-xs">
              <div className="mb-3 flex items-center justify-between border-b border-zinc-100 pb-2.5">
                <OrvexaLogo compact />
                <div className="flex-1 pl-2.5">
                  <h3 className="text-xs font-semibold text-zinc-900">Human-Only Approval Gate</h3>
                  <p className="text-[10px] text-zinc-500">Explicit authorized human decision required</p>
                </div>
                {!canApproveOrders && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                    <Lock className="h-3 w-3" /> Review Only
                  </span>
                )}
              </div>

              <input
                type="text"
                disabled={isFinalized}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Reviewer note or approval reference..."
                className="mb-3 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-teal-700 focus:bg-white focus:outline-none disabled:opacity-50"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={loading || !canApproveOrders || isFinalized}
                  onClick={() => handleDecision("approved")}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-teal-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve PO
                </button>
                <button
                  type="button"
                  disabled={loading || !canApproveOrders || isFinalized}
                  onClick={() => handleDecision("rejected")}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </button>
                <button
                  type="button"
                  disabled={loading || isFinalized}
                  onClick={() => handleDecision("request_clarification")}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
                >
                  Request Clarification
                </button>
                <button
                  type="button"
                  disabled={loading || isFinalized}
                  onClick={() => handleDecision("save_draft")}
                  className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-40"
                >
                  Save Draft
                </button>
              </div>

              <div className="mt-3 space-y-2 border-t border-zinc-100 pt-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={runOrderCtpCheck}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-800 hover:bg-zinc-50"
                  >
                    <Gauge className="h-3.5 w-3.5 text-teal-700" /> Capable-to-Promise (CTP LP)
                  </button>
                  {activeOrder.status === "approved" && (
                    <button
                      type="button"
                      onClick={exportApprovedCsv}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-zinc-900 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-800"
                    >
                      <Download className="h-3.5 w-3.5" /> Export CSV
                    </button>
                  )}
                </div>

                {ctpResult && (
                  <div
                    className={`rounded-xl border p-2.5 text-[11px] ${
                      ctpResult.feasible_within_standard_capacity
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-amber-200 bg-amber-50 text-amber-900"
                    }`}
                  >
                    <div className="font-semibold">
                      {ctpResult.feasible_within_standard_capacity
                        ? `Feasible within standard capacity (Estimated lead time: ${ctpResult.estimated_lead_days} days)`
                        : `Requires ${ctpResult.total_overtime_hours_needed} overtime hours (Estimated lead time: ${ctpResult.estimated_lead_days} days)`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-white p-12 text-center">
          <div className="mx-auto mb-3 flex justify-center">
            <OrvexaLogo compact />
          </div>
          <p className="text-sm font-semibold text-zinc-800">No Purchase Orders in this company queue yet</p>
          <p className="mt-1 text-xs text-zinc-500">
            Upload a CSV/TXT Purchase Order or click one of the Enterprise Feed Presets above to run mathematical OR optimization.
          </p>
        </div>
      )}
    </div>
  );
}
