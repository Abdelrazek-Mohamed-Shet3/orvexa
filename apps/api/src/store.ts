import { randomUUID } from "node:crypto";

export type UserRole =
  | "owner"
  | "org_admin"
  | "ops_manager"
  | "sales_rep"
  | "order_processor"
  | "reviewer_approver"
  | "read_only";

export type OrderStatus =
  | "received"
  | "processing"
  | "needs_review"
  | "needs_clarification"
  | "draft"
  | "approved"
  | "rejected"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface OrganizationRules {
  allowBrokenCartons: boolean;
  requireDeliveryAddress: boolean;
  conformalAlpha: number;
  slaMinutesDefault: number;
}

export interface SkuDemandStat {
  sku: string;
  daily_demand_mean: number;
  daily_demand_std: number;
  lead_time_days: number;
  unit_cost_egp: number;
  unit_margin_egp: number;
  holding_cost_per_unit_year: number;
  order_setup_cost_egp: number;
  service_level_z: number;
  current_stock_units: number;
  horizon_demand_units: number;
}

export interface PlantResourceSpec {
  resource_id: string;
  resource_name_ar: string;
  available_hours: number;
  hours_per_unit_by_sku: Record<string, number>;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  businessType: string;
  currency: string;
  erpConnector: string;
  operatingRules: OrganizationRules;
  skuDemandStats: SkuDemandStat[];
  resources: PlantResourceSpec[];
  historicalPoTexts: string[];
}

export interface MemberContext {
  userId: string;
  organizationId: string;
  fullName: string;
  role: UserRole;
  canApproveOrders: boolean;
}

export interface PackagingTier {
  unit_code: string;
  unit_label_ar: string;
  base_multiplier: number;
  is_orderable: boolean;
}

export interface ProductRecord {
  id: string;
  organizationId: string;
  sku: string;
  name_ar: string;
  name_en: string;
  brand: string;
  base_unit: string;
  standard_price: number;
  moq_base_units: number;
  allow_broken_pack: boolean;
  is_available: boolean;
  packaging_levels: PackagingTier[];
  aliases: string[];
  customer_aliases: Record<string, string[]>;
}

export interface CustomerRecord {
  id: string;
  organizationId: string;
  company_name: string;
  contact_person: string;
  phone: string;
  delivery_address: string;
  is_active: boolean;
  priority_weight: number;
  historical_sku_counts: Record<string, number>;
}

export interface OrderRecord {
  id: string;
  organizationId: string;
  incomingRequestId: string;
  sourceChannel: string;
  rawText: string;
  customerId: string | null;
  status: OrderStatus;
  orAnalysis: Record<string, unknown> | null;
  humanEdits: Record<string, unknown>[];
  approvedByUserId: string | null;
  approvedAt: string | null;
  rejectionRationale: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerEntry {
  id: number;
  organizationId: string;
  entityType: string;
  entityId: string;
  action: string;
  actorType: "human" | "ai_pipeline" | "or_solver" | "system";
  actorUserId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export class OrvexaStore {
  private organizations = new Map<string, OrganizationRecord>();
  private members = new Map<string, MemberContext>();
  private customers = new Map<string, CustomerRecord>();
  private products = new Map<string, ProductRecord>();
  private orders = new Map<string, OrderRecord>();
  private ledger: LedgerEntry[] = [];
  private ledgerSeq = 1;

  constructor() {
    this.seedEnterpriseData();
  }

  private seedEnterpriseData() {
    const orgSewedy = "11111111-1111-1111-1111-111111111111";
    const orgMobica = "11111111-1111-1111-1111-111111111112";

    this.organizations.set(orgSewedy, {
      id: orgSewedy,
      name: "El Sewedy Electric — Cables & Power Systems",
      businessType: "Electrical Manufacturing & B2B Cable Distribution",
      currency: "EGP",
      erpConnector: "SAP S/4HANA — Live Production & PO Connector",
      operatingRules: {
        allowBrokenCartons: false,
        requireDeliveryAddress: true,
        conformalAlpha: 0.05,
        slaMinutesDefault: 30,
      },
      skuDemandStats: [
        {
          sku: "CBL-SWD-3X16-100M",
          daily_demand_mean: 42.0,
          daily_demand_std: 9.5,
          lead_time_days: 7.0,
          unit_cost_egp: 178.0,
          unit_margin_egp: 67.0,
          holding_cost_per_unit_year: 24.0,
          order_setup_cost_egp: 3500.0,
          service_level_z: 1.65,
          current_stock_units: 240.0,
          horizon_demand_units: 1200.0,
        },
        {
          sku: "ABB-MCB-63A",
          daily_demand_mean: 28.0,
          daily_demand_std: 6.0,
          lead_time_days: 10.0,
          unit_cost_egp: 590.0,
          unit_margin_egp: 230.0,
          holding_cost_per_unit_year: 85.0,
          order_setup_cost_egp: 2800.0,
          service_level_z: 1.65,
          current_stock_units: 420.0,
          horizon_demand_units: 800.0,
        },
        {
          sku: "OIL-TRN-200L",
          daily_demand_mean: 2.5,
          daily_demand_std: 0.9,
          lead_time_days: 14.0,
          unit_cost_egp: 21500.0,
          unit_margin_egp: 7000.0,
          holding_cost_per_unit_year: 2600.0,
          order_setup_cost_egp: 9000.0,
          service_level_z: 1.96,
          current_stock_units: 28.0,
          horizon_demand_units: 60.0,
        },
      ],
      resources: [
        {
          resource_id: "COPPER-DRAW",
          resource_name_ar: "Copper Drawing & Stranding Line",
          available_hours: 480.0,
          hours_per_unit_by_sku: { "CBL-SWD-3X16-100M": 0.45, "ABB-MCB-63A": 0.05, "OIL-TRN-200L": 0.0 },
        },
        {
          resource_id: "XLPE-INSUL",
          resource_name_ar: "XLPE Insulation & Sheathing Line",
          available_hours: 360.0,
          hours_per_unit_by_sku: { "CBL-SWD-3X16-100M": 0.35, "ABB-MCB-63A": 0.08, "OIL-TRN-200L": 0.2 },
        },
        {
          resource_id: "QA-TESTING",
          resource_name_ar: "HV Quality & Voltage Testing Lab",
          available_hours: 520.0,
          hours_per_unit_by_sku: { "CBL-SWD-3X16-100M": 0.1, "ABB-MCB-63A": 0.25, "OIL-TRN-200L": 1.8 },
        },
      ],
      historicalPoTexts: [
        "SKU,Description,Quantity,Unit\nCBL-SWD-3X16-100M,El Sewedy Copper Cable 3x16,4,reel\nABB-MCB-63A,ABB 63A Circuit Breaker,18,unit",
        "2 pallet transformer oil\n5 reel elsewedy 3x16",
      ],
    });

    this.organizations.set(orgMobica, {
      id: orgMobica,
      name: "Mobica Furniture — Commercial & Contract Fit-Out",
      businessType: "Enterprise Furniture Manufacturing & Contract Fit-Out",
      currency: "EGP",
      erpConnector: "Oracle Fusion ERP — Plant & Project Orders Sync",
      operatingRules: {
        allowBrokenCartons: false,
        requireDeliveryAddress: true,
        conformalAlpha: 0.05,
        slaMinutesDefault: 25,
      },
      skuDemandStats: [
        {
          sku: "MOB-EXEC-DESK",
          daily_demand_mean: 4.5,
          daily_demand_std: 1.4,
          lead_time_days: 9.0,
          unit_cost_egp: 19200.0,
          unit_margin_egp: 9300.0,
          holding_cost_per_unit_year: 1900.0,
          order_setup_cost_egp: 4800.0,
          service_level_z: 1.65,
          current_stock_units: 14.0,
          horizon_demand_units: 95.0,
        },
        {
          sku: "MOB-ERG-CHAIR",
          daily_demand_mean: 16.0,
          daily_demand_std: 3.5,
          lead_time_days: 5.0,
          unit_cost_egp: 6100.0,
          unit_margin_egp: 3400.0,
          holding_cost_per_unit_year: 620.0,
          order_setup_cost_egp: 2600.0,
          service_level_z: 1.65,
          current_stock_units: 110.0,
          horizon_demand_units: 320.0,
        },
        {
          sku: "MOB-WRK-STN4",
          daily_demand_mean: 2.8,
          daily_demand_std: 1.1,
          lead_time_days: 12.0,
          unit_cost_egp: 34000.0,
          unit_margin_egp: 14500.0,
          holding_cost_per_unit_year: 3100.0,
          order_setup_cost_egp: 6500.0,
          service_level_z: 1.65,
          current_stock_units: 18.0,
          horizon_demand_units: 55.0,
        },
      ],
      resources: [
        {
          resource_id: "WOOD-CNC",
          resource_name_ar: "CNC Woodworking Line (Abu Rawash)",
          available_hours: 420.0,
          hours_per_unit_by_sku: { "MOB-EXEC-DESK": 4.2, "MOB-ERG-CHAIR": 0.4, "MOB-WRK-STN4": 6.0 },
        },
        {
          resource_id: "UPHOLSTERY",
          resource_name_ar: "Upholstery & Metal Assembly",
          available_hours: 600.0,
          hours_per_unit_by_sku: { "MOB-EXEC-DESK": 1.1, "MOB-ERG-CHAIR": 1.4, "MOB-WRK-STN4": 2.2 },
        },
        {
          resource_id: "FINISHING-PAINT",
          resource_name_ar: "Automated Finishing & Paint Ovens",
          available_hours: 490.0,
          hours_per_unit_by_sku: { "MOB-EXEC-DESK": 2.0, "MOB-ERG-CHAIR": 0.3, "MOB-WRK-STN4": 3.5 },
        },
      ],
      historicalPoTexts: [
        "SKU,Description,Quantity,Unit\nMOB-EXEC-DESK,Mobica Executive Desk 200cm,12,unit\nMOB-ERG-CHAIR,Mobica Ergonomic Mesh Chair,25,unit",
        "10 carton mobica mesh chair\n4 unit workstation 4",
      ],
    });

    this.members.set("22222222-2222-2222-2222-222222222221", {
      userId: "22222222-2222-2222-2222-222222222221",
      organizationId: orgSewedy,
      fullName: "Eng. Abdelrazek Sheta — Executive Director",
      role: "owner",
      canApproveOrders: true,
    });
    this.members.set("22222222-2222-2222-2222-222222222222", {
      userId: "22222222-2222-2222-2222-222222222222",
      organizationId: orgSewedy,
      fullName: "Eng. Mohamed Sheta — Operations Manager",
      role: "ops_manager",
      canApproveOrders: true,
    });
    this.members.set("22222222-2222-2222-2222-222222222223", {
      userId: "22222222-2222-2222-2222-222222222223",
      organizationId: orgSewedy,
      fullName: "Kareem Adel — Order Processor",
      role: "order_processor",
      canApproveOrders: false,
    });

    const customers: CustomerRecord[] = [
      {
        id: "33333333-3333-3333-3333-333333333301",
        organizationId: orgSewedy,
        company_name: "Orascom Construction — MEP Division",
        contact_person: "Eng. Tarek Mansour",
        phone: "+201001234567",
        delivery_address: "10th of Ramadan Industrial Zone B4",
        is_active: true,
        priority_weight: 2.5,
        historical_sku_counts: { "44444444-4444-4444-4444-444444444401": 18 },
      },
      {
        id: "33333333-3333-3333-3333-333333333302",
        organizationId: orgSewedy,
        company_name: "Hassan Allam Technologies & Engineering",
        contact_person: "Eng. Khaled Fouad",
        phone: "+201119876543",
        delivery_address: "New Administrative Capital — Central Business District",
        is_active: true,
        priority_weight: 2.0,
        historical_sku_counts: { "44444444-4444-4444-4444-444444444402": 11 },
      },
      {
        id: "33333333-3333-3333-3333-333333333303",
        organizationId: orgMobica,
        company_name: "Commercial International Bank (CIB) — Branch Fit-Out",
        contact_person: "Sherif El Wakeel",
        phone: "+201223344556",
        delivery_address: "Smart Village — Central HQ Tower",
        is_active: true,
        priority_weight: 2.8,
        historical_sku_counts: { "44444444-4444-4444-4444-444444444405": 22 },
      },
      {
        id: "33333333-3333-3333-3333-333333333304",
        organizationId: orgMobica,
        company_name: "Vodafone Egypt — Corporate Headquarters",
        contact_person: "Eng. Nader Selim",
        phone: "+201099887766",
        delivery_address: "Smart Village — Building C2",
        is_active: true,
        priority_weight: 2.2,
        historical_sku_counts: { "44444444-4444-4444-4444-444444444406": 15 },
      },
    ];
    for (const c of customers) this.customers.set(c.id, c);

    const demoProducts: ProductRecord[] = [
      {
        id: "44444444-4444-4444-4444-444444444401",
        organizationId: orgSewedy,
        sku: "CBL-SWD-3X16-100M",
        name_ar: "El Sewedy Copper Cable 3x16mm (100m Reel)",
        name_en: "El Sewedy Copper Cable 3x16mm (100m Reel)",
        brand: "El Sewedy",
        base_unit: "meter",
        standard_price: 245,
        moq_base_units: 100,
        allow_broken_pack: false,
        is_available: true,
        packaging_levels: [
          { unit_code: "reel", unit_label_ar: "reel", base_multiplier: 100, is_orderable: true },
          { unit_code: "meter", unit_label_ar: "meter", base_multiplier: 1, is_orderable: true },
        ],
        aliases: ["elsewedy 3x16", "copper cable 3x16", "swd 3x16"],
        customer_aliases: {},
      },
      {
        id: "44444444-4444-4444-4444-444444444402",
        organizationId: orgSewedy,
        sku: "ABB-MCB-63A",
        name_ar: "ABB 3-Pole Circuit Breaker 63A",
        name_en: "ABB 3-Pole Circuit Breaker 63A",
        brand: "ABB",
        base_unit: "unit",
        standard_price: 820,
        moq_base_units: 12,
        allow_broken_pack: false,
        is_available: true,
        packaging_levels: [
          { unit_code: "carton", unit_label_ar: "carton", base_multiplier: 12, is_orderable: true },
          { unit_code: "unit", unit_label_ar: "unit", base_multiplier: 1, is_orderable: true },
        ],
        aliases: ["abb 63a", "breaker 63a", "mcb 63a"],
        customer_aliases: {},
      },
      {
        id: "44444444-4444-4444-4444-444444444404",
        organizationId: orgSewedy,
        sku: "OIL-TRN-200L",
        name_ar: "Transformer Insulating Oil 200L Drum",
        name_en: "Transformer Insulating Oil 200L Drum",
        brand: "El Sewedy Power",
        base_unit: "unit",
        standard_price: 28500,
        moq_base_units: 1,
        allow_broken_pack: true,
        is_available: true,
        packaging_levels: [
          { unit_code: "pallet", unit_label_ar: "pallet", base_multiplier: 4, is_orderable: true },
          { unit_code: "drum", unit_label_ar: "drum", base_multiplier: 1, is_orderable: true },
        ],
        aliases: ["transformer oil", "insulating oil 200l", "diala oil"],
        customer_aliases: {},
      },
      {
        id: "44444444-4444-4444-4444-444444444405",
        organizationId: orgMobica,
        sku: "MOB-EXEC-DESK",
        name_ar: "Mobica Executive Desk 200cm Natural Walnut",
        name_en: "Mobica Executive Desk 200cm Natural Walnut",
        brand: "Mobica",
        base_unit: "unit",
        standard_price: 28500,
        moq_base_units: 1,
        allow_broken_pack: true,
        is_available: true,
        packaging_levels: [
          { unit_code: "unit", unit_label_ar: "unit", base_multiplier: 1, is_orderable: true },
        ],
        aliases: ["mobica executive desk", "executive desk 200", "walnut desk 200cm"],
        customer_aliases: {},
      },
      {
        id: "44444444-4444-4444-4444-444444444406",
        organizationId: orgMobica,
        sku: "MOB-ERG-CHAIR",
        name_ar: "Mobica Ergonomic Mesh Chair (2/Carton)",
        name_en: "Mobica Ergonomic Mesh Chair (2/Carton)",
        brand: "Mobica",
        base_unit: "unit",
        standard_price: 9500,
        moq_base_units: 4,
        allow_broken_pack: false,
        is_available: true,
        packaging_levels: [
          { unit_code: "carton", unit_label_ar: "carton", base_multiplier: 2, is_orderable: true },
          { unit_code: "unit", unit_label_ar: "unit", base_multiplier: 1, is_orderable: true },
        ],
        aliases: ["mobica mesh chair", "ergonomic mesh chair", "ergo chair"],
        customer_aliases: {},
      },
      {
        id: "44444444-4444-4444-4444-444444444407",
        organizationId: orgMobica,
        sku: "MOB-WRK-STN4",
        name_ar: "Mobica 4-Person Acoustic Workstation",
        name_en: "Mobica 4-Person Acoustic Workstation",
        brand: "Mobica",
        base_unit: "unit",
        standard_price: 48500,
        moq_base_units: 2,
        allow_broken_pack: true,
        is_available: true,
        packaging_levels: [
          { unit_code: "unit", unit_label_ar: "unit", base_multiplier: 1, is_orderable: true },
        ],
        aliases: ["workstation 4", "mobica cluster 4", "acoustic cluster"],
        customer_aliases: {},
      },
    ];
    for (const p of demoProducts) this.products.set(p.id, p);
  }

  getMember(userId: string, overrideOrgId?: string): MemberContext | undefined {
    const m = this.members.get(userId);
    if (!m) return undefined;
    if (overrideOrgId && this.organizations.has(overrideOrgId)) {
      return { ...m, organizationId: overrideOrgId };
    }
    return m;
  }

  listOrganizations(): OrganizationRecord[] {
    return [...this.organizations.values()];
  }

  getOrganization(orgId: string): OrganizationRecord | undefined {
    return this.organizations.get(orgId);
  }

  createOrganization(input: {
    name: string;
    businessType: string;
    erpConnector: string;
    operatingRules?: Partial<OrganizationRules>;
  }): OrganizationRecord {
    const id = randomUUID();
    const org: OrganizationRecord = {
      id,
      name: input.name,
      businessType: input.businessType,
      currency: "EGP",
      erpConnector: input.erpConnector,
      operatingRules: {
        allowBrokenCartons: input.operatingRules?.allowBrokenCartons ?? false,
        requireDeliveryAddress: input.operatingRules?.requireDeliveryAddress ?? true,
        conformalAlpha: input.operatingRules?.conformalAlpha ?? 0.05,
        slaMinutesDefault: input.operatingRules?.slaMinutesDefault ?? 30,
      },
      skuDemandStats: [],
      resources: [],
      historicalPoTexts: [],
    };
    this.organizations.set(id, org);
    return org;
  }

  updateOrganizationRules(orgId: string, rules: Partial<OrganizationRules>): OrganizationRecord {
    const org = this.organizations.get(orgId);
    if (!org) throw new Error("ORG_NOT_FOUND");
    org.operatingRules = { ...org.operatingRules, ...rules };
    return org;
  }

  importProducts(orgId: string, items: Array<Omit<ProductRecord, "id" | "organizationId">>): ProductRecord[] {
    const created: ProductRecord[] = [];
    for (const item of items) {
      const rec: ProductRecord = {
        ...item,
        id: randomUUID(),
        organizationId: orgId,
      };
      this.products.set(rec.id, rec);
      created.push(rec);
    }
    this.appendLedger({
      organizationId: orgId,
      entityType: "product_catalog",
      entityId: orgId,
      action: "ENTERPRISE_CATALOG_SYNCED",
      actorType: "system",
      actorUserId: null,
      payload: { importedCount: created.length },
    });
    return created;
  }

  listCustomers(orgId: string): CustomerRecord[] {
    return [...this.customers.values()].filter((c) => c.organizationId === orgId);
  }

  getCustomer(orgId: string, customerId: string): CustomerRecord | undefined {
    const c = this.customers.get(customerId);
    return c && c.organizationId === orgId ? c : undefined;
  }

  listProducts(orgId: string): ProductRecord[] {
    return [...this.products.values()].filter((p) => p.organizationId === orgId);
  }

  listOrders(orgId: string): OrderRecord[] {
    return [...this.orders.values()]
      .filter((o) => o.organizationId === orgId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOrder(orgId: string, orderId: string): OrderRecord | undefined {
    const o = this.orders.get(orderId);
    return o && o.organizationId === orgId ? o : undefined;
  }

  createOrderFromIntake(
    orgId: string,
    actorUserId: string,
    rawText: string,
    customerId: string | null,
    orAnalysis: Record<string, unknown>,
    recommendedStatus: OrderStatus,
    sourceChannel = "enterprise_feed"
  ): OrderRecord {
    const now = new Date().toISOString();
    const order: OrderRecord = {
      id: randomUUID(),
      organizationId: orgId,
      incomingRequestId: randomUUID(),
      sourceChannel,
      rawText,
      customerId,
      status: recommendedStatus,
      orAnalysis,
      humanEdits: [],
      approvedByUserId: null,
      approvedAt: null,
      rejectionRationale: null,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);
    this.appendLedger({
      organizationId: orgId,
      entityType: "candidate_order",
      entityId: order.id,
      action: "ORDER_INTAKE_AND_OR_ANALYZED",
      actorType: "or_solver",
      actorUserId,
      payload: { recommendedStatus, customerId, sourceChannel },
    });
    return order;
  }

  applyRevalidation(
    member: MemberContext,
    orderId: string,
    customerId: string | null,
    orAnalysis: Record<string, unknown>,
    recommendedStatus: OrderStatus,
    editDetail: Record<string, unknown>
  ): OrderRecord {
    const order = this.getOrder(member.organizationId, orderId);
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status === "approved" || order.status === "rejected") {
      throw new Error("ORDER_ALREADY_FINALIZED");
    }

    order.customerId = customerId;
    order.orAnalysis = orAnalysis;
    if (order.status !== "draft") {
      order.status = recommendedStatus;
    }
    order.humanEdits.push({
      ...editDetail,
      editedBy: member.userId,
      editedAt: new Date().toISOString(),
    });
    order.updatedAt = new Date().toISOString();

    this.appendLedger({
      organizationId: member.organizationId,
      entityType: "candidate_order",
      entityId: order.id,
      action: "HUMAN_EDIT_AND_OR_REVALIDATED",
      actorType: "human",
      actorUserId: member.userId,
      payload: editDetail,
    });
    return order;
  }

  decideOrder(
    member: MemberContext,
    orderId: string,
    decision: "approved" | "rejected" | "save_draft" | "request_clarification",
    rationale?: string
  ): OrderRecord {
    const order = this.getOrder(member.organizationId, orderId);
    if (!order) throw new Error("ORDER_NOT_FOUND");

    if (decision === "approved" || decision === "rejected") {
      if (!member.canApproveOrders) {
        throw new Error("FORBIDDEN_APPROVAL_AUTHORITY");
      }
      if (decision === "approved") {
        const feasible = Boolean((order.orAnalysis as { overall_feasible?: boolean } | null)?.overall_feasible);
        if (!feasible && !rationale?.trim()) {
          throw new Error("UNRESOLVED_VALIDATION_FAILURES");
        }
      }
    }

    const now = new Date().toISOString();
    const statusMap: Record<typeof decision, OrderStatus> = {
      approved: "approved",
      rejected: "rejected",
      save_draft: "draft",
      request_clarification: "needs_clarification",
    };

    order.status = statusMap[decision];
    order.updatedAt = now;
    if (decision === "approved") {
      order.approvedByUserId = member.userId;
      order.approvedAt = now;
    } else if (decision === "rejected") {
      order.rejectionRationale = rationale ?? "Rejected by authorized reviewer";
    }

    this.appendLedger({
      organizationId: member.organizationId,
      entityType: "candidate_order",
      entityId: order.id,
      action: `HUMAN_DECISION_${decision.toUpperCase()}`,
      actorType: "human",
      actorUserId: member.userId,
      payload: { rationale: rationale ?? null, role: member.role },
    });

    return order;
  }

  recordEnterpriseDiagnostics(orgId: string, actorUserId: string, optimalMargin: number) {
    this.appendLedger({
      organizationId: orgId,
      entityType: "enterprise_system",
      entityId: orgId,
      action: "ENTERPRISE_OR_DIAGNOSTICS_EXECUTED",
      actorType: "or_solver",
      actorUserId,
      payload: { optimalMargin },
    });
  }

  addVerifiedProductAlias(
    member: MemberContext,
    productId: string,
    aliasText: string
  ): ProductRecord {
    const prod = this.products.get(productId);
    if (!prod || prod.organizationId !== member.organizationId) {
      throw new Error("PRODUCT_NOT_FOUND");
    }
    const trimmed = aliasText.trim();
    if (trimmed && !prod.aliases.includes(trimmed)) {
      prod.aliases.push(trimmed);
      this.appendLedger({
        organizationId: member.organizationId,
        entityType: "product",
        entityId: prod.id,
        action: "HUMAN_VERIFIED_ALIAS_ADDED",
        actorType: "human",
        actorUserId: member.userId,
        payload: { sku: prod.sku, aliasText: trimmed },
      });
    }
    return prod;
  }

  getLedger(orgId: string, entityId?: string): LedgerEntry[] {
    return this.ledger
      .filter((e) => e.organizationId === orgId && (!entityId || e.entityId === entityId))
      .sort((a, b) => b.id - a.id);
  }

  private appendLedger(entry: Omit<LedgerEntry, "id" | "occurredAt">) {
    this.ledger.push({
      ...entry,
      id: this.ledgerSeq++,
      occurredAt: new Date().toISOString(),
    });
  }
}
