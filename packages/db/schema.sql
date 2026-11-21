-- ORVEXA Order Intelligence — Production Multi-Tenant Schema (PostgreSQL 17)
-- Enforces Spec §6.6 (Clear Separation of States), §13 (Information Concepts),
-- §14.8 (Traceability), and §14.9 (Strict Multi-Tenant Isolation via RLS).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ---------------------------------------------------------------------------
-- 1. Organizations & RBAC (Spec §8.1, §8.2, §12)
-- ---------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM (
  'owner',
  'org_admin',
  'ops_manager',
  'sales_rep',
  'order_processor',
  'reviewer_approver',
  'read_only'
);

CREATE TYPE order_lifecycle_status AS ENUM (
  'received',
  'processing',
  'needs_review',
  'needs_clarification',
  'draft',
  'approved',
  'rejected',
  'in_progress',
  'completed',
  'cancelled'
);

CREATE TYPE matching_outcome AS ENUM (
  'clear_match',
  'possible_match',
  'multiple_matches',
  'no_match',
  'conflicting'
);

CREATE TYPE validation_status AS ENUM (
  'passed',
  'warning',
  'failed',
  'requires_human_review',
  'not_applicable'
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  business_type TEXT NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'EG',
  default_currency CHAR(3) NOT NULL DEFAULT 'EGP',
  default_language TEXT NOT NULL DEFAULT 'ar',
  operating_rules JSONB NOT NULL DEFAULT '{
    "allow_broken_cartons": false,
    "require_delivery_address": true,
    "conformal_alpha": 0.01,
    "sla_minutes_default": 30
  }'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL,
  can_approve_orders BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- ---------------------------------------------------------------------------
-- 2. Customers & Product Catalog (Spec §8.3, §8.4, §13.3-13.5)
-- ---------------------------------------------------------------------------

CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_code TEXT,
  company_name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  delivery_address TEXT,
  tax_registration_no TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  priority_weight NUMERIC(6, 2) NOT NULL DEFAULT 1.0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT NOT NULL,
  brand TEXT,
  category TEXT,
  base_unit TEXT NOT NULL, -- e.g. 'piece', 'kg', 'liter'
  standard_price NUMERIC(12, 2),
  moq_base_units INTEGER NOT NULL DEFAULT 1,
  allow_broken_pack BOOLEAN NOT NULL DEFAULT false,
  is_available BOOLEAN NOT NULL DEFAULT true,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, sku)
);

CREATE TABLE product_packaging_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,       -- e.g. 'carton', 'pack', 'piece'
  unit_label_ar TEXT NOT NULL,   -- e.g. 'كرتونة', 'باكت', 'قطعة'
  base_multiplier INTEGER NOT NULL CHECK (base_multiplier >= 1),
  is_orderable BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (product_id, unit_code)
);

CREATE TABLE product_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE, -- NULL = org-wide alias
  alias_text TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  verified_by_human BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_aliases_trgm ON product_aliases USING gin (normalized_alias gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 3. Incoming Requests -> Candidate Orders -> Approved Orders (Spec §6.6)
-- ---------------------------------------------------------------------------

CREATE TABLE incoming_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id),
  intake_channel TEXT NOT NULL CHECK (intake_channel IN ('pasted_text', 'manual_entry', 'document_upload')),
  raw_content TEXT NOT NULL,
  document_uri TEXT,
  source_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE candidate_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incoming_request_id UUID NOT NULL REFERENCES incoming_requests(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES customers(id),
  status order_lifecycle_status NOT NULL DEFAULT 'received',
  delivery_address TEXT,
  requested_delivery_date DATE,
  notes TEXT,
  assigned_reviewer_id UUID REFERENCES users(id),
  sla_deadline_at TIMESTAMPTZ,
  or_diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE candidate_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_order_id UUID NOT NULL REFERENCES candidate_orders(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL,
  -- Raw / AI Extracted (Never overwrites source truth)
  raw_description TEXT NOT NULL,
  source_span_start INTEGER,
  source_span_end INTEGER,
  source_bbox JSONB,
  extracted_quantity NUMERIC(12, 3),
  extracted_unit TEXT,
  -- OR Matching & Packaging Output
  suggested_product_id UUID REFERENCES products(id),
  confirmed_product_id UUID REFERENCES products(id),
  matching_outcome matching_outcome NOT NULL DEFAULT 'no_match',
  mismatch_cost NUMERIC(8, 5),
  confirmed_quantity NUMERIC(12, 3),
  confirmed_unit TEXT,
  packaging_decomposition JSONB,
  is_human_confirmed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE validation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_order_id UUID NOT NULL REFERENCES candidate_orders(id) ON DELETE CASCADE,
  rule_code TEXT NOT NULL,
  status validation_status NOT NULL,
  is_in_mus BOOLEAN NOT NULL DEFAULT false, -- Minimal Unsatisfiable Subset flag
  message TEXT NOT NULL,
  suggested_repair TEXT,
  evaluated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE review_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_order_id UUID NOT NULL REFERENCES candidate_orders(id) ON DELETE CASCADE,
  reviewer_user_id UUID NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('save_draft', 'request_clarification', 'approved', 'rejected')),
  rationale TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approved_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  candidate_order_id UUID NOT NULL UNIQUE REFERENCES candidate_orders(id) ON DELETE RESTRICT,
  order_reference TEXT NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id),
  approved_by_user_id UUID NOT NULL REFERENCES users(id),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status order_lifecycle_status NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'in_progress', 'completed', 'cancelled')),
  total_amount NUMERIC(14, 2),
  line_items_snapshot JSONB NOT NULL,
  UNIQUE (organization_id, order_reference)
);

-- ---------------------------------------------------------------------------
-- 4. Immutable Activity & Accountability Ledger (Spec §8.13, §14.8)
-- ---------------------------------------------------------------------------

CREATE TABLE activity_ledger (
  id BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('human', 'ai_pipeline', 'or_solver', 'system')),
  actor_user_id UUID REFERENCES users(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prevent updates or deletes on activity_ledger
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'activity_ledger is immutable and append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_immutable_ledger
BEFORE UPDATE OR DELETE ON activity_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- ---------------------------------------------------------------------------
-- 5. Row-Level Security (RLS) Multi-Tenant Isolation (Spec §14.9)
-- ---------------------------------------------------------------------------

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_packaging_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE validation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE approved_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_ledger ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'customers', 'products', 'product_packaging_levels', 'product_aliases',
    'incoming_requests', 'candidate_orders', 'candidate_order_items',
    'validation_results', 'review_decisions', 'approved_orders', 'activity_ledger'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY tenant_isolation_%I ON %I USING (organization_id = NULLIF(current_setting(''app.current_org_id'', true), '''')::uuid);',
      tbl, tbl
    );
  END LOOP;
END $$;
