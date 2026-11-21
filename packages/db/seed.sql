-- Seed Data for Realistic Egyptian B2B FMCG Distributor Pilot Scenario

INSERT INTO organizations (id, name, business_type, country_code, default_currency, default_language)
VALUES (
  '11111111-1111-1111-1111-111111111111',
  'شركة النيل لتوزيع السلع الغذائية (Demo)',
  'Food and Beverage Wholesaler',
  'EG',
  'EGP',
  'ar'
) ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, full_name) VALUES
  ('22222222-2222-2222-2222-222222222221', 'abdelrazek.sheta@orvexa.eg', 'Eng. Abdelrazek Sheta - Executive Director'),
  ('22222222-2222-2222-2222-222222222222', 'mohamed.sheta@orvexa.eg', 'Eng. Mohamed Sheta - Operations Manager'),
  ('22222222-2222-2222-2222-222222222223', 'processor@orvexa.eg', 'Kareem Adel - Order Processor')
ON CONFLICT DO NOTHING;

INSERT INTO organization_memberships (organization_id, user_id, role, can_approve_orders) VALUES
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', 'owner', true),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'ops_manager', true),
  ('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222223', 'order_processor', false)
ON CONFLICT DO NOTHING;

INSERT INTO customers (id, organization_id, customer_code, company_name, contact_person, phone, delivery_address, is_active, priority_weight) VALUES
  ('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111111', 'CUST-101', 'أسواق الفتح التجارية', 'الحاج مصطفى', '+201001234567', 'مدينة نصر - شارع عباس العقاد', true, 1.8),
  ('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111111', 'CUST-102', 'سوبر ماركت البركة', 'طارق حسن', '+201119876543', 'المهندسين - شارع جامعة الدول', true, 1.2)
ON CONFLICT DO NOTHING;

INSERT INTO products (id, organization_id, sku, name_ar, name_en, brand, category, base_unit, standard_price, moq_base_units, allow_broken_pack, is_available) VALUES
  ('44444444-4444-4444-4444-444444444401', '11111111-1111-1111-1111-111111111111', 'OIL-CRY-1L', 'زيت كريستال ذرة 1 لتر', 'Crystal Corn Oil 1L', 'Crystal', 'Oils', 'bottle', 95.00, 12, false, true),
  ('44444444-4444-4444-4444-444444444402', '11111111-1111-1111-1111-111111111111', 'TEA-LIP-250', 'شاي ليبتون ناعم 250 جرام', 'Lipton Black Tea 250g', 'Lipton', 'Beverages', 'pack', 68.00, 12, false, true),
  ('44444444-4444-4444-4444-444444444403', '11111111-1111-1111-1111-111111111111', 'MLK-JHN-1L', 'لبن جهينة كامل الدسم 1 لتر', 'Juhayna Full Cream Milk 1L', 'Juhayna', 'Dairy', 'pack', 44.00, 12, false, true),
  ('44444444-4444-4444-4444-444444444404', '11111111-1111-1111-1111-111111111111', 'PAS-MLK-400', 'مكرونة الملكة قلم 400 جرام', 'El Maleka Penne Pasta 400g', 'El Maleka', 'Dry Goods', 'pack', 16.50, 20, true, true)
ON CONFLICT DO NOTHING;

INSERT INTO product_packaging_levels (organization_id, product_id, unit_code, unit_label_ar, base_multiplier) VALUES
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'carton', 'كرتونة', 12),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'bottle', 'زجاجة', 1),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444402', 'carton', 'كرتونة', 24),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444402', 'pack', 'باكت', 1),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444403', 'carton', 'كرتونة', 12),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444403', 'pack', 'عبوة', 1),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444404', 'sack', 'شكارة', 20),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444404', 'pack', 'كيس', 1)
ON CONFLICT DO NOTHING;

INSERT INTO product_aliases (organization_id, product_id, alias_text, normalized_alias, verified_by_human) VALUES
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'كريستال ذرة لتر', 'كريستال ذره لتر', true),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444401', 'crystal 1L', 'crystal 1l', true),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444402', 'ليبتون ربع كيلو', 'ليبتون ربع كيلو', true),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444403', 'لبن جهينة احمر', 'لبن جهينه احمر', true),
  ('11111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444404', 'ملكه قلم 400', 'ملكه قلم 400', true)
ON CONFLICT DO NOTHING;
