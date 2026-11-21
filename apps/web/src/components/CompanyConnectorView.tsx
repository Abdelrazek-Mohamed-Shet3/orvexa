"use client";

import React, { useState } from "react";
import { Building, CheckCircle2, Database, FileSpreadsheet, Plus, Settings2, Upload } from "lucide-react";
import { OrvexaLogo } from "./OrvexaLogo";

export interface OrganizationView {
  id: string;
  name: string;
  businessType: string;
  currency: string;
  erpConnector: string;
  operatingRules: {
    allowBrokenCartons: boolean;
    requireDeliveryAddress: boolean;
    conformalAlpha: number;
    slaMinutesDefault: number;
  };
}

const SAMPLE_ERP_CSV = `SKU,Name_Ar,Name_En,BaseUnit,Price,PackUnit,PackMultiplier,MOQ,Aliases
PMP-GRD-5HP,Grundfos Industrial Pump 5HP,Grundfos Industrial Pump 5HP,unit,18500,pallet,2,1,grundfos 5hp|industrial pump 5hp
UPS-APC-10KVA,APC Smart-UPS 10KVA Online,APC Smart-UPS 10KVA Online,unit,64000,unit,1,1,apc 10kva|smart ups 10kva`;

export function CompanyConnectorView({
  apiBase,
  activeUserId,
  activeOrg,
  onSyncComplete,
  onSwitchOrg,
}: {
  apiBase: string;
  activeUserId: string;
  activeOrg: OrganizationView | undefined;
  onSyncComplete: () => Promise<void>;
  onSwitchOrg: (orgId: string) => void;
}) {
  const [allowBroken, setAllowBroken] = useState(activeOrg?.operatingRules.allowBrokenCartons ?? false);
  const [requireAddress, setRequireAddress] = useState(activeOrg?.operatingRules.requireDeliveryAddress ?? true);
  const [alpha, setAlpha] = useState(activeOrg?.operatingRules.conformalAlpha ?? 0.05);
  const [slaMin, setSlaMin] = useState(activeOrg?.operatingRules.slaMinutesDefault ?? 30);

  const [csvText, setCsvText] = useState(SAMPLE_ERP_CSV);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgType, setNewOrgType] = useState("Industrial & Manufacturing B2B");
  const [newOrgErp, setNewOrgErp] = useState("SAP / Oracle / CSV Feed");
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveRules() {
    if (!activeOrg) return;
    setBusy(true);
    setStatusNote(null);
    try {
      const res = await fetch(`${apiBase}/v1/organization/rules`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-user-id": activeUserId,
          "x-org-id": activeOrg.id,
        },
        body: JSON.stringify({
          allowBrokenCartons: allowBroken,
          requireDeliveryAddress: requireAddress,
          conformalAlpha: alpha,
          slaMinutesDefault: slaMin,
        }),
      });
      if (!res.ok) throw new Error("Failed to save operating rules");
      setStatusNote("Organization OR operating rules updated successfully.");
      await onSyncComplete();
    } catch (e) {
      setStatusNote(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  async function importCatalogCsv() {
    if (!activeOrg) return;
    setBusy(true);
    setStatusNote(null);
    try {
      const res = await fetch(`${apiBase}/v1/catalog/import`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": activeUserId,
          "x-org-id": activeOrg.id,
        },
        body: JSON.stringify({ csvText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Catalog import failed");
      setStatusNote(`Synced ${data.importedCount} new SKU(s) into "${activeOrg.name}" and live OR matrices.`);
      await onSyncComplete();
    } catch (e) {
      setStatusNote(e instanceof Error ? e.message : "Import error");
    } finally {
      setBusy(false);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvText(await file.text());
  }

  async function createCompany(e: React.FormEvent) {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setBusy(true);
    setStatusNote(null);
    try {
      const res = await fetch(`${apiBase}/v1/organizations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: newOrgName.trim(),
          businessType: newOrgType,
          erpConnector: newOrgErp,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error("Failed to create organization");
      setNewOrgName("");
      setStatusNote(`Connected new organization "${data.organization.name}" with full RLS tenant isolation.`);
      await onSyncComplete();
      onSwitchOrg(data.organization.id);
    } catch (e) {
      setStatusNote(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
        <div className="flex items-center gap-4">
          <OrvexaLogo compact />
          <div>
            <h2 className="text-base font-bold text-zinc-900">
              Enterprise ERP & Data Connector ({activeOrg?.name})
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Connects directly to the company&apos;s ERP catalog, packaging rules, and purchase order feeds without manual prompt entry.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-xs">
          <span className="text-zinc-500">Active Connector: </span>
          <span className="font-mono font-semibold text-zinc-900">{activeOrg?.erpConnector}</span>
        </div>
      </div>

      {statusNote && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" />
          <span>{statusNote}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs lg:col-span-5">
          <div className="flex items-center gap-2 border-b border-zinc-100 pb-3">
            <Settings2 className="h-4 w-4 text-teal-700" />
            <h3 className="text-sm font-semibold text-zinc-900">OR Engine Operating Rules</h3>
          </div>

          <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 text-xs">
            <div>
              <div className="font-semibold text-zinc-900">Allow Breaking Sealed Cartons / Packs</div>
              <div className="text-[11px] text-zinc-500">Controls Integer Packaging MILP constraints</div>
            </div>
            <input
              type="checkbox"
              checked={allowBroken}
              onChange={(e) => setAllowBroken(e.target.checked)}
              className="h-4 w-4 accent-teal-700"
            />
          </label>

          <label className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 text-xs">
            <div>
              <div className="font-semibold text-zinc-900">Require Customer Delivery Address</div>
              <div className="text-[11px] text-zinc-500">Hard constraint inside CP-SAT + MUS</div>
            </div>
            <input
              type="checkbox"
              checked={requireAddress}
              onChange={(e) => setRequireAddress(e.target.checked)}
              className="h-4 w-4 accent-teal-700"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 text-xs">
              <span className="text-zinc-500">Conformal Risk (α)</span>
              <input
                type="number"
                step="0.01"
                min="0.005"
                max="0.5"
                value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900"
              />
            </label>
            <label className="rounded-xl border border-zinc-200 bg-zinc-50/60 p-3 text-xs">
              <span className="text-zinc-500">Default SLA (minutes)</span>
              <input
                type="number"
                min="5"
                max="480"
                value={slaMin}
                onChange={(e) => setSlaMin(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900"
              />
            </label>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={saveRules}
            className="w-full rounded-xl bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            Save & Apply Organization Rules
          </button>

          <form onSubmit={createCompany} className="space-y-3 border-t border-zinc-100 pt-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-900">
              <Building className="h-4 w-4 text-zinc-600" />
              <span>Onboard New Enterprise Tenant</span>
            </div>
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="Organization Name (e.g., Ezz Steel Distribution)"
              className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-teal-700 focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={newOrgType}
                onChange={(e) => setNewOrgType(e.target.value)}
                placeholder="Industry"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-teal-700 focus:outline-none"
              />
              <input
                type="text"
                value={newOrgErp}
                onChange={(e) => setNewOrgErp(e.target.value)}
                placeholder="ERP System"
                className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-900 focus:border-teal-700 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              disabled={busy || !newOrgName.trim()}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Create Isolated Tenant Workspace
            </button>
          </form>
        </section>

        <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 pb-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-teal-700" />
              <h3 className="text-sm font-semibold text-zinc-900">ERP / CSV Catalog Synchronization</h3>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100">
              <Upload className="h-3.5 w-3.5" />
              <span>Upload CSV File</span>
              <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          <p className="text-xs text-zinc-500">
            Paste or upload your ERP product catalog export to immediately populate Global Assignment & Packaging MILP matrices:
          </p>

          <textarea
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-50 p-3.5 font-mono text-xs leading-6 text-zinc-800 focus:border-teal-700 focus:bg-white focus:outline-none"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              <span>Packaging tiers & MOQ rules update live with zero downtime.</span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={importCatalogCsv}
              className="rounded-xl bg-teal-700 px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-teal-800 disabled:opacity-50"
            >
              Sync Catalog to OR Engine
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
