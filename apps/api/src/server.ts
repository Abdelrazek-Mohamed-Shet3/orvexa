import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { OrvexaStore, type CustomerRecord, type MemberContext } from "./store.ts";

const SCIENCE_ENGINE_URL = process.env.SCIENCE_ENGINE_URL ?? "http://127.0.0.1:8001";

function toScienceCustomer(customer: CustomerRecord | undefined) {
  if (!customer) return null;
  return {
    id: customer.id,
    company_name: customer.company_name,
    is_active: customer.is_active,
    has_delivery_address: Boolean(customer.delivery_address),
    priority_weight: customer.priority_weight,
    historical_sku_counts: customer.historical_sku_counts,
  };
}

export function buildServer(store = new OrvexaStore()) {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  function authenticate(headers: Record<string, unknown>): MemberContext {
    const userId =
      typeof headers["x-user-id"] === "string" && headers["x-user-id"].trim()
        ? headers["x-user-id"].trim()
        : "22222222-2222-2222-2222-222222222221";
    const orgId = typeof headers["x-org-id"] === "string" ? headers["x-org-id"].trim() : undefined;
    const member = store.getMember(userId, orgId);
    if (!member) {
      throw new Error("UNAUTHORIZED");
    }
    return member;
  }

  app.get("/health", async () => ({ status: "ok", service: "orvexa-core-api" }));

  app.get("/v1/organizations", async () => ({
    organizations: store.listOrganizations(),
  }));

  const CreateOrgSchema = z.object({
    name: z.string().min(2),
    businessType: z.string().min(2),
    erpConnector: z.string().min(2).default("Custom ERP / CSV Sync"),
    allowBrokenCartons: z.boolean().default(false),
    requireDeliveryAddress: z.boolean().default(true),
    conformalAlpha: z.number().min(0.005).max(0.5).default(0.05),
    slaMinutesDefault: z.number().int().min(5).max(480).default(30),
  });

  app.post("/v1/organizations", async (req, reply) => {
    const parsed = CreateOrgSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const org = store.createOrganization({
      name: parsed.data.name,
      businessType: parsed.data.businessType,
      erpConnector: parsed.data.erpConnector,
      operatingRules: {
        allowBrokenCartons: parsed.data.allowBrokenCartons,
        requireDeliveryAddress: parsed.data.requireDeliveryAddress,
        conformalAlpha: parsed.data.conformalAlpha,
        slaMinutesDefault: parsed.data.slaMinutesDefault,
      },
    });
    return reply.code(201).send({ organization: org });
  });

  const UpdateRulesSchema = z.object({
    allowBrokenCartons: z.boolean().optional(),
    requireDeliveryAddress: z.boolean().optional(),
    conformalAlpha: z.number().min(0.005).max(0.5).optional(),
    slaMinutesDefault: z.number().int().min(5).max(480).optional(),
  });

  app.patch("/v1/organization/rules", async (req, reply) => {
    const member = authenticate(req.headers);
    const parsed = UpdateRulesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const organization = store.updateOrganizationRules(member.organizationId, parsed.data);
    return { organization };
  });

  app.get("/v1/context", async (req) => {
    const member = authenticate(req.headers);
    return {
      member,
      organization: store.getOrganization(member.organizationId),
      organizations: store.listOrganizations(),
      customers: store.listCustomers(member.organizationId),
      products: store.listProducts(member.organizationId),
    };
  });

  const CatalogImportSchema = z.object({
    csvText: z.string().min(1),
  });

  app.post("/v1/catalog/import", async (req, reply) => {
    const member = authenticate(req.headers);
    const parsed = CatalogImportSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const lines = parsed.data.csvText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      return reply.code(400).send({ error: "CSV must include header row and at least one product row." });
    }

    const items = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim());
      if (cols.length < 4) continue;
      const [sku, nameAr, nameEn, baseUnit, priceStr, packUnit, packMultStr, moqStr, aliasesStr] = cols;
      const packMult = Math.max(1, Number(packMultStr) || 1);
      const moq = Math.max(1, Number(moqStr) || 1);
      const price = Math.max(0, Number(priceStr) || 0);

      items.push({
        sku: sku.toUpperCase(),
        name_ar: nameAr,
        name_en: nameEn || nameAr,
        brand: "Enterprise Import",
        base_unit: baseUnit || "unit",
        standard_price: price,
        moq_base_units: moq,
        allow_broken_pack: store.getOrganization(member.organizationId)?.operatingRules.allowBrokenCartons ?? false,
        is_available: true,
        packaging_levels: [
          ...(packUnit && packMult > 1
            ? [{ unit_code: packUnit, unit_label_ar: packUnit, base_multiplier: packMult, is_orderable: true }]
            : []),
          { unit_code: baseUnit || "unit", unit_label_ar: baseUnit || "unit", base_multiplier: 1, is_orderable: true },
        ],
        aliases: aliasesStr ? aliasesStr.split("|").map((a) => a.trim()).filter(Boolean) : [],
        customer_aliases: {},
      });
    }

    const created = store.importProducts(member.organizationId, items);
    return reply.code(201).send({ importedCount: created.length, products: created });
  });

  app.get("/v1/orders", async (req) => {
    const member = authenticate(req.headers);
    return { orders: store.listOrders(member.organizationId) };
  });

  app.get("/v1/ledger", async (req) => {
    const member = authenticate(req.headers);
    const q = req.query as { orderId?: string };
    return { entries: store.getLedger(member.organizationId, q.orderId) };
  });

  const IntakeSchema = z.object({
    rawText: z.string().min(1),
    customerId: z.string().nullable().default(null),
    sourceChannel: z.string().default("enterprise_po_feed"),
    requireDeliveryAddress: z.boolean().optional(),
    allowDuplicateSkus: z.boolean().default(false),
  });

  app.post("/v1/orders/intake", async (req, reply) => {
    const member = authenticate(req.headers);
    if (member.role === "read_only") {
      return reply.code(403).send({ error: "Read-only users cannot create orders." });
    }

    const parsed = IntakeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const org = store.getOrganization(member.organizationId);
    const { rawText, customerId, sourceChannel, allowDuplicateSkus } = parsed.data;
    const requireDeliveryAddress =
      parsed.data.requireDeliveryAddress ?? org?.operatingRules.requireDeliveryAddress ?? true;

    const customer = customerId ? store.getCustomer(member.organizationId, customerId) : undefined;
    const products = store.listProducts(member.organizationId);

    const sciRes = await fetch(`${SCIENCE_ENGINE_URL}/v1/orders/process`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: member.organizationId,
        raw_text: rawText,
        customer: toScienceCustomer(customer),
        catalog: products,
        require_delivery_address: requireDeliveryAddress,
        allow_duplicate_skus: allowDuplicateSkus,
      }),
    });

    if (!sciRes.ok) {
      return reply.code(502).send({ error: "Science & OR engine error", detail: await sciRes.text() });
    }

    const orAnalysis = (await sciRes.json()) as {
      recommended_status: "needs_review" | "needs_clarification";
    };

    const order = store.createOrderFromIntake(
      member.organizationId,
      member.userId,
      rawText,
      customer?.id ?? null,
      orAnalysis as Record<string, unknown>,
      orAnalysis.recommended_status,
      sourceChannel
    );

    return reply.code(201).send({ order });
  });

  const EditLineAndRevalidateSchema = z.object({
    lineNumber: z.number().int().positive(),
    confirmedProductId: z.string().optional(),
    confirmedQuantity: z.number().positive().optional(),
    confirmedUnit: z.string().optional(),
    isHumanConfirmed: z.boolean().default(true),
  });

  app.patch("/v1/orders/:orderId/lines", async (req, reply) => {
    const member = authenticate(req.headers);
    if (member.role === "read_only") {
      return reply.code(403).send({ error: "FORBIDDEN_READ_ONLY" });
    }

    const { orderId } = req.params as { orderId: string };
    const parsed = EditLineAndRevalidateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const existing = store.getOrder(member.organizationId, orderId);
    if (!existing) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    if (existing.status === "approved" || existing.status === "rejected") {
      return reply.code(400).send({ error: "ORDER_ALREADY_FINALIZED" });
    }

    const org = store.getOrganization(member.organizationId);
    const customer = existing.customerId
      ? store.getCustomer(member.organizationId, existing.customerId)
      : undefined;
    const products = store.listProducts(member.organizationId);
    const prevAnalysis = (existing.orAnalysis ?? {}) as {
      lines?: unknown[];
      detected_customer_hint?: string | null;
      header_notes?: string[];
    };

    const sciRes = await fetch(`${SCIENCE_ENGINE_URL}/v1/orders/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: member.organizationId,
        raw_text: existing.rawText,
        customer: toScienceCustomer(customer),
        catalog: products,
        current_lines: prevAnalysis.lines ?? [],
        edits: [
          {
            line_number: parsed.data.lineNumber,
            confirmed_product_id: parsed.data.confirmedProductId ?? null,
            confirmed_quantity: parsed.data.confirmedQuantity ?? null,
            confirmed_unit: parsed.data.confirmedUnit ?? null,
            is_human_confirmed: parsed.data.isHumanConfirmed,
          },
        ],
        require_delivery_address: org?.operatingRules.requireDeliveryAddress ?? true,
        detected_customer_hint: prevAnalysis.detected_customer_hint ?? null,
        header_notes: prevAnalysis.header_notes ?? [],
      }),
    });

    if (!sciRes.ok) {
      return reply.code(502).send({ error: "Science & OR revalidation error", detail: await sciRes.text() });
    }

    const updatedAnalysis = (await sciRes.json()) as {
      recommended_status: "needs_review" | "needs_clarification";
    };

    const order = store.applyRevalidation(
      member,
      orderId,
      existing.customerId,
      updatedAnalysis as Record<string, unknown>,
      updatedAnalysis.recommended_status,
      parsed.data
    );
    return { order };
  });

  const AssignCustomerSchema = z.object({
    customerId: z.string().min(1),
  });

  app.patch("/v1/orders/:orderId/customer", async (req, reply) => {
    const member = authenticate(req.headers);
    if (member.role === "read_only") {
      return reply.code(403).send({ error: "FORBIDDEN_READ_ONLY" });
    }
    const { orderId } = req.params as { orderId: string };
    const parsed = AssignCustomerSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const existing = store.getOrder(member.organizationId, orderId);
    if (!existing) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });

    const customer = store.getCustomer(member.organizationId, parsed.data.customerId);
    if (!customer) return reply.code(404).send({ error: "CUSTOMER_NOT_FOUND" });

    const prevAnalysis = (existing.orAnalysis ?? {}) as {
      lines?: unknown[];
      detected_customer_hint?: string | null;
      header_notes?: string[];
    };

    const sciRes = await fetch(`${SCIENCE_ENGINE_URL}/v1/orders/revalidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organization_id: member.organizationId,
        raw_text: existing.rawText,
        customer: toScienceCustomer(customer),
        catalog: store.listProducts(member.organizationId),
        current_lines: prevAnalysis.lines ?? [],
        edits: [],
        detected_customer_hint: prevAnalysis.detected_customer_hint ?? null,
        header_notes: prevAnalysis.header_notes ?? [],
      }),
    });

    if (!sciRes.ok) {
      return reply.code(502).send({ error: await sciRes.text() });
    }
    const updatedAnalysis = (await sciRes.json()) as {
      recommended_status: "needs_review" | "needs_clarification";
    };

    const order = store.applyRevalidation(
      member,
      orderId,
      customer.id,
      updatedAnalysis as Record<string, unknown>,
      updatedAnalysis.recommended_status,
      { assignedCustomerId: customer.id }
    );
    return { order };
  });

  const DecisionSchema = z.object({
    decision: z.enum(["approved", "rejected", "save_draft", "request_clarification"]),
    rationale: z.string().optional(),
  });

  app.post("/v1/orders/:orderId/decide", async (req, reply) => {
    const member = authenticate(req.headers);
    const { orderId } = req.params as { orderId: string };
    const parsed = DecisionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    try {
      const updated = store.decideOrder(member, orderId, parsed.data.decision, parsed.data.rationale);
      return { order: updated };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "UNKNOWN_ERROR";
      if (msg === "ORDER_NOT_FOUND") return reply.code(404).send({ error: msg });
      if (msg === "FORBIDDEN_APPROVAL_AUTHORITY") {
        return reply.code(403).send({
          error: "Only authorized human roles with approval authority can approve or reject orders (Spec §14.6).",
        });
      }
      if (msg === "UNRESOLVED_VALIDATION_FAILURES") {
        return reply.code(422).send({
          error: "Unresolved hard validation failures require explicit rationale before approval (Spec §14.14).",
        });
      }
      return reply.code(400).send({ error: msg });
    }
  });

  app.post("/v1/or/schedule-reviews", async (req, reply) => {
    authenticate(req.headers);
    const sciRes = await fetch(`${SCIENCE_ENGINE_URL}/v1/or/schedule-reviews`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
    if (!sciRes.ok) return reply.code(502).send({ error: await sciRes.text() });
    return await sciRes.json();
  });

  app.post("/v1/or/calibrate-conformal", async (req, reply) => {
    authenticate(req.headers);
    const sciRes = await fetch(`${SCIENCE_ENGINE_URL}/v1/or/calibrate-conformal`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
    if (!sciRes.ok) return reply.code(502).send({ error: await sciRes.text() });
    return await sciRes.json();
  });

  const EnterpriseAnalyzeSchema = z.object({
    workingCapitalBudgetEgp: z.number().positive().nullable().optional(),
    customPayload: z.record(z.unknown()).optional(),
  });

  app.post("/v1/enterprise/analyze", async (req, reply) => {
    const member = authenticate(req.headers);
    const org = store.getOrganization(member.organizationId);
    if (!org) return reply.code(404).send({ error: "ORG_NOT_FOUND" });

    const parsed = EnterpriseAnalyzeSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const products = store.listProducts(member.organizationId);
    const bodyPayload = parsed.data.customPayload ?? {
      organization_id: org.id,
      organization_name: org.name,
      catalog: products,
      sku_demand_stats: org.skuDemandStats,
      resources: org.resources,
      historical_po_texts: org.historicalPoTexts,
      working_capital_budget_egp: parsed.data.workingCapitalBudgetEgp ?? null,
    };

    const sciRes = await fetch(`${SCIENCE_ENGINE_URL}/v1/or/analyze-company`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyPayload),
    });
    if (!sciRes.ok) return reply.code(502).send({ error: await sciRes.text() });
    const result = (await sciRes.json()) as { optimal_total_margin_egp?: number };
    store.recordEnterpriseDiagnostics(member.organizationId, member.userId, result.optimal_total_margin_egp ?? 0);
    return result;
  });

  const AliasSchema = z.object({
    aliasText: z.string().min(2),
  });

  app.post("/v1/products/:productId/aliases", async (req, reply) => {
    const member = authenticate(req.headers);
    if (member.role === "read_only") {
      return reply.code(403).send({ error: "FORBIDDEN_READ_ONLY" });
    }
    const { productId } = req.params as { productId: string };
    const parsed = AliasSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const product = store.addVerifiedProductAlias(member, productId, parsed.data.aliasText);
      return { product };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : "PRODUCT_NOT_FOUND" });
    }
  });

  app.post("/v1/orders/:orderId/check-ctp", async (req, reply) => {
    const member = authenticate(req.headers);
    const { orderId } = req.params as { orderId: string };
    const order = store.getOrder(member.organizationId, orderId);
    if (!order) return reply.code(404).send({ error: "ORDER_NOT_FOUND" });
    const org = store.getOrganization(member.organizationId);
    if (!org) return reply.code(404).send({ error: "ORG_NOT_FOUND" });

    const lines = ((order.orAnalysis as { lines?: Array<{ assigned_sku?: string; packaging_solution?: { allocated_base_units?: number } }> } | null)?.lines ?? []);
    const skuDemands: Record<string, number> = {};
    for (const ln of lines) {
      if (ln.assigned_sku && ln.packaging_solution?.allocated_base_units) {
        skuDemands[ln.assigned_sku] = (skuDemands[ln.assigned_sku] ?? 0) + ln.packaging_solution.allocated_base_units;
      }
    }

    const sciRes = await fetch(`${SCIENCE_ENGINE_URL}/v1/or/check-ctp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sku_demands: skuDemands,
        sku_demand_stats: org.skuDemandStats,
        resources: org.resources,
      }),
    });
    if (!sciRes.ok) return reply.code(502).send({ error: await sciRes.text() });
    return await sciRes.json();
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 4000);
  const app = buildServer();
  app.listen({ port, host: "0.0.0.0" }).then(() => {
    console.log(`ORVEXA Core API listening on http://localhost:${port}`);
  });
}
