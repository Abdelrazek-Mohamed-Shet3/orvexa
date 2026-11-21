"use client";

import React, { useState } from "react";
import { Box, Building2, CheckCircle2, Lock, Search, Tag } from "lucide-react";

export interface CatalogProductView {
  id: string;
  sku: string;
  name_ar: string;
  name_en: string;
  brand: string;
  base_unit: string;
  standard_price: number;
  moq_base_units: number;
  allow_broken_pack: boolean;
  is_available: boolean;
  packaging_levels: Array<{
    unit_code: string;
    unit_label_ar: string;
    base_multiplier: number;
    is_orderable: boolean;
  }>;
  aliases: string[];
}

export interface CustomerView {
  id: string;
  company_name: string;
  contact_person: string;
  phone: string;
  delivery_address: string;
  is_active: boolean;
  priority_weight: number;
}

export function CatalogView({
  products,
  customers,
}: {
  products: CatalogProductView[];
  customers: CustomerView[];
}) {
  const [query, setQuery] = useState("");
  const filtered = products.filter(
    (p) =>
      p.name_en.toLowerCase().includes(query.toLowerCase()) ||
      p.name_ar.toLowerCase().includes(query.toLowerCase()) ||
      p.sku.toLowerCase().includes(query.toLowerCase()) ||
      p.aliases.some((a) => a.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
        <div className="mb-4 flex items-center gap-2 border-b border-zinc-100 pb-3">
          <Building2 className="h-4 w-4 text-teal-700" />
          <h2 className="text-sm font-semibold text-zinc-900">Registered Enterprise B2B Accounts</h2>
        </div>
        {customers.length === 0 ? (
          <p className="text-xs text-zinc-500">No customers registered in this workspace yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {customers.map((c) => (
              <div
                key={c.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-900">{c.company_name}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" /> Active
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-600">
                    Contact: {c.contact_person} • {c.phone}
                  </p>
                  <p className="mt-0.5 text-xs text-zinc-500">Delivery Site: {c.delivery_address}</p>
                </div>
                <div className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-center">
                  <div className="text-[10px] text-zinc-500">SLA Weight</div>
                  <div className="font-mono text-xs font-semibold text-zinc-900">w = {c.priority_weight}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-3">
          <div className="flex items-center gap-2">
            <Box className="h-4 w-4 text-zinc-800" />
            <h2 className="text-sm font-semibold text-zinc-900">Product Catalog & Packaging Tiers ({products.length} SKUs)</h2>
          </div>
          <div className="relative w-full sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by SKU, product name, or alias..."
              className="w-full rounded-xl border border-zinc-200 bg-zinc-50 py-2 pl-9 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-teal-700 focus:bg-white focus:outline-none"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="py-6 text-center text-xs text-zinc-500">
            No matching products found — sync a catalog from the Company & ERP Connector tab.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {filtered.map((p) => (
              <div
                key={p.id}
                className="rounded-xl border border-zinc-200 bg-white p-4 transition hover:border-zinc-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md border border-zinc-200 bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-zinc-800">
                        {p.sku}
                      </span>
                      <span className="text-sm font-semibold text-zinc-900">{p.name_en}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-zinc-500">Brand: {p.brand}</p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-bold text-teal-800">
                      {p.standard_price.toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP
                    </div>
                    <div className="text-[10px] text-zinc-500">per {p.base_unit}</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
                  {p.packaging_levels.map((lvl) => (
                    <span
                      key={lvl.unit_code}
                      className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-700"
                    >
                      {lvl.unit_code} = <span className="font-mono font-semibold text-zinc-900">{lvl.base_multiplier}</span> {p.base_unit}
                    </span>
                  ))}
                  <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-zinc-700">
                    MOQ: <span className="font-mono font-semibold">{p.moq_base_units}</span>
                  </span>
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${
                      p.allow_broken_pack
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {!p.allow_broken_pack && <Lock className="h-3 w-3" />}
                    {p.allow_broken_pack ? "Broken Pack Allowed" : "Sealed Packs Only"}
                  </span>
                </div>

                {p.aliases.length > 0 && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2.5 text-[11px]">
                    <Tag className="h-3 w-3 text-zinc-400" />
                    <span className="text-zinc-500">Verified Aliases:</span>
                    {p.aliases.map((a) => (
                      <span key={a} className="rounded bg-zinc-100 px-2 py-0.5 text-zinc-700">
                        {a}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
