"use client";

import React, { useCallback, useEffect, useState } from "react";
import { BarChart3, BookOpen, Building2, Cpu, History, Layers, PlugZap } from "lucide-react";
import { SplitWorkbench, type OrderRecord } from "@/components/SplitWorkbench";
import { OperationsDashboard } from "@/components/OperationsDashboard";
import { CatalogView, type CatalogProductView, type CustomerView } from "@/components/CatalogView";
import { CompanyConnectorView, type OrganizationView } from "@/components/CompanyConnectorView";
import { EnterpriseDiagnosticsView } from "@/components/EnterpriseDiagnosticsView";
import { OrvexaLogo } from "@/components/OrvexaLogo";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const USERS = [
  {
    id: "22222222-2222-2222-2222-222222222221",
    label: "Eng. Abdelrazek Sheta (Executive Director — Approver)",
    canApprove: true,
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    label: "Eng. Mohamed Sheta (Operations Manager — Approver)",
    canApprove: true,
  },
  {
    id: "22222222-2222-2222-2222-222222222223",
    label: "Kareem Adel (Order Processor — Review Only)",
    canApprove: false,
  },
];

type TabKey = "diagnostics" | "workbench" | "connector" | "operations" | "catalog" | "ledger";

export default function HomePage() {
  const [tab, setTab] = useState<TabKey>("diagnostics");
  const [activeUserId, setActiveUserId] = useState(USERS[0].id);
  const [activeOrgId, setActiveOrgId] = useState("11111111-1111-1111-1111-111111111111");
  const [organizations, setOrganizations] = useState<OrganizationView[]>([]);
  const [activeOrg, setActiveOrg] = useState<OrganizationView | undefined>(undefined);
  const [customers, setCustomers] = useState<CustomerView[]>([]);
  const [products, setProducts] = useState<CatalogProductView[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [ledger, setLedger] = useState<
    Array<{ id: number; action: string; actorType: string; occurredAt: string; payload: Record<string, unknown> }>
  >([]);
  const [apiConnected, setApiConnected] = useState(true);

  const activeUser = USERS.find((u) => u.id === activeUserId) ?? USERS[0];

  const refreshData = useCallback(async () => {
    try {
      const headers = { "x-user-id": activeUserId, "x-org-id": activeOrgId };
      const [ctxRes, ordRes, ledRes] = await Promise.all([
        fetch(`${API_BASE}/v1/context`, { headers }),
        fetch(`${API_BASE}/v1/orders`, { headers }),
        fetch(`${API_BASE}/v1/ledger`, { headers }),
      ]);
      if (!ctxRes.ok) throw new Error("API unavailable");
      const ctx = await ctxRes.json();
      const ord = await ordRes.json();
      const led = await ledRes.json();
      setOrganizations(ctx.organizations ?? []);
      setActiveOrg(ctx.organization);
      setCustomers(ctx.customers ?? []);
      setProducts(ctx.products ?? []);
      setOrders(ord.orders ?? []);
      setLedger(led.entries ?? []);
      setApiConnected(true);
    } catch {
      setApiConnected(false);
    }
  }, [activeUserId, activeOrgId]);

  useEffect(() => {
    refreshData();
  }, [refreshData]);

  const navItems: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
    { key: "diagnostics", label: "Enterprise OR Diagnostics", icon: <Cpu className="h-3.5 w-3.5" /> },
    { key: "workbench", label: "Order Workbench", icon: <Layers className="h-3.5 w-3.5" /> },
    { key: "connector", label: "Company & ERP Connector", icon: <PlugZap className="h-3.5 w-3.5" /> },
    { key: "operations", label: "Review Queue & Conformal", icon: <BarChart3 className="h-3.5 w-3.5" /> },
    { key: "catalog", label: "Catalog & Customers", icon: <BookOpen className="h-3.5 w-3.5" /> },
    { key: "ledger", label: "Audit Ledger", icon: <History className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-zinc-900">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-5 py-3">
          <div className="flex flex-wrap items-center gap-5">
            <OrvexaLogo />

            {organizations.length > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                <Building2 className="h-3.5 w-3.5 text-teal-700" />
                <select
                  value={activeOrgId}
                  onChange={(e) => setActiveOrgId(e.target.value)}
                  className="bg-transparent text-xs font-semibold text-zinc-800 focus:outline-none"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                apiConnected
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : "border-rose-200 bg-rose-50 text-rose-800"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${apiConnected ? "bg-emerald-600" : "bg-rose-600"}`} />
              {apiConnected ? "OR Engine Ready" : "Disconnected"}
            </span>

            <select
              value={activeUserId}
              onChange={(e) => setActiveUserId(e.target.value)}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 focus:border-teal-700 focus:outline-none"
            >
              {USERS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="border-t border-zinc-100 bg-white">
          <div className="mx-auto flex max-w-[1440px] items-center gap-1 overflow-x-auto px-5">
            {navItems.map((item) => {
              const active = tab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => setTab(item.key)}
                  className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-xs font-semibold transition ${
                    active
                      ? "border-zinc-900 text-zinc-900"
                      : "border-transparent text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-6">
        {!apiConnected && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            Ensure <span className="font-mono">services/science-engine</span> (port 8001) and{" "}
            <span className="font-mono">apps/api</span> (port 4000) are running for live optimization.
          </div>
        )}

        {tab === "diagnostics" && (
          <EnterpriseDiagnosticsView
            apiBase={API_BASE}
            activeUserId={activeUserId}
            activeOrgId={activeOrgId}
            activeOrgName={activeOrg?.name ?? ""}
          />
        )}
        {tab === "workbench" && (
          <SplitWorkbench
            apiBase={API_BASE}
            activeUserId={activeUserId}
            activeOrgId={activeOrgId}
            canApproveOrders={activeUser.canApprove}
            customers={customers}
            products={products}
            orders={orders}
            onOrderCreatedOrUpdated={refreshData}
          />
        )}
        {tab === "connector" && (
          <CompanyConnectorView
            apiBase={API_BASE}
            activeUserId={activeUserId}
            activeOrg={activeOrg}
            onSyncComplete={refreshData}
            onSwitchOrg={(id) => setActiveOrgId(id)}
          />
        )}
        {tab === "operations" && (
          <OperationsDashboard apiBase={API_BASE} activeUserId={activeUserId} />
        )}
        {tab === "catalog" && <CatalogView products={products} customers={customers} />}
        {tab === "ledger" && (
          <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
            <div className="mb-4 flex items-center justify-between border-b border-zinc-100 pb-3">
              <h2 className="text-sm font-semibold text-zinc-900">
                Immutable Activity & Accountability Ledger
              </h2>
              <OrvexaLogo compact />
            </div>
            {ledger.length === 0 ? (
              <p className="text-xs text-zinc-500">No events recorded for this organization yet.</p>
            ) : (
              <div className="space-y-2">
                {ledger.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50/70 px-4 py-3 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono font-semibold text-teal-800">#{entry.id}</span>
                      <span className="font-mono font-semibold text-zinc-900">{entry.action}</span>
                      <span className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 font-mono text-[10px] text-zinc-600">
                        {entry.actorType}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-500">{entry.occurredAt}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
