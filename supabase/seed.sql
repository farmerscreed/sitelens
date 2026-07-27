-- M0 · Seed for the AC-6 isolation test.
-- Two tenants (Org A, Org B), each with a user, membership (admin), project, and
-- a spread of rows across representative tables. The isolation test asserts a
-- user of one org cannot read a single row belonging to the other, by any route.
--
-- Runs as postgres during `supabase db reset` (bypasses RLS), so inserts succeed.
-- Fixed UUIDs so the tests can reference cross-org rows directly.

-- ── Fixed identifiers ────────────────────────────
-- Org A ids start a…, Org B ids start b… for readability.

-- Organizations
INSERT INTO organizations (id, name) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'Org A — Lawone Dev'),
  ('b0000000-0000-0000-0000-0000000000bb', 'Org B — Rival Builders');

-- Global identities (mirror auth.users.id; no FK to auth schema by design)
INSERT INTO app_users (id, full_name, phone) VALUES
  ('a1111111-1111-1111-1111-111111111111', 'Ada (Org A admin)',  '+2348000000001'),
  ('b2222222-2222-2222-2222-222222222222', 'Bode (Org B admin)', '+2348000000002');

-- Memberships (both admins of their own org)
INSERT INTO memberships (id, org_id, user_id, role) VALUES
  ('a3333333-3333-3333-3333-333333333333', 'a0000000-0000-0000-0000-0000000000aa', 'a1111111-1111-1111-1111-111111111111', 'admin'),
  ('b4444444-4444-4444-4444-444444444444', 'b0000000-0000-0000-0000-0000000000bb', 'b2222222-2222-2222-2222-222222222222', 'admin');

-- Projects
INSERT INTO projects (id, org_id, name, created_by) VALUES
  ('a5555555-5555-5555-5555-555555555555', 'a0000000-0000-0000-0000-0000000000aa', 'Estate A', 'a1111111-1111-1111-1111-111111111111'),
  ('b6666666-6666-6666-6666-666666666666', 'b0000000-0000-0000-0000-0000000000bb', 'Estate B', 'b2222222-2222-2222-2222-222222222222');

-- Materials catalog
INSERT INTO materials_catalog (id, org_id, name, unit) VALUES
  ('a7777777-7777-7777-7777-777777777777', 'a0000000-0000-0000-0000-0000000000aa', 'Cement (50kg)', 'bag'),
  ('b8888888-8888-8888-8888-888888888888', 'b0000000-0000-0000-0000-0000000000bb', 'Cement (50kg)', 'bag');

-- Dated price list (proves Rule 4 / current_price later)
INSERT INTO material_prices (org_id, material_id, unit_price, effective_from, entered_by) VALUES
  ('a0000000-0000-0000-0000-0000000000aa', 'a7777777-7777-7777-7777-777777777777', 9500.00, CURRENT_DATE, 'a3333333-3333-3333-3333-333333333333'),
  ('b0000000-0000-0000-0000-0000000000bb', 'b8888888-8888-8888-8888-888888888888', 9800.00, CURRENT_DATE, 'b4444444-4444-4444-4444-444444444444');

-- Budget lines
INSERT INTO budget_lines (id, project_id, cost_code, name, budgeted_amount) VALUES
  ('a9999999-9999-9999-9999-999999999999', 'a5555555-5555-5555-5555-555555555555', 'MAT', 'Materials', 5000000),
  ('b9999999-9999-9999-9999-999999999999', 'b6666666-6666-6666-6666-666666666666', 'MAT', 'Materials', 5000000);

-- Building types (recipes)
INSERT INTO building_types (id, org_id, name, category, created_by) VALUES
  ('aaaa0000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000aa', 'Terrace Type A', 'terrace', 'a3333333-3333-3333-3333-333333333333'),
  ('bbbb0000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000bb', 'Terrace Type B', 'terrace', 'b4444444-4444-4444-4444-444444444444');

-- Buildings (copies of a recipe)
INSERT INTO buildings (id, org_id, project_id, building_type_id, code) VALUES
  ('aabb0000-0000-0000-0000-0000000000a1', 'a0000000-0000-0000-0000-0000000000aa', 'a5555555-5555-5555-5555-555555555555', 'aaaa0000-0000-0000-0000-0000000000a1', 'A-01'),
  ('aabb0000-0000-0000-0000-0000000000b1', 'b0000000-0000-0000-0000-0000000000bb', 'b6666666-6666-6666-6666-666666666666', 'bbbb0000-0000-0000-0000-0000000000b1', 'B-01');

-- Financial rows (append-only; unique idempotency_key each)
INSERT INTO expenses (id, project_id, budget_line_id, amount, description, created_by, idempotency_key) VALUES
  ('a1a1a1a1-0000-0000-0000-0000000000a1', 'a5555555-5555-5555-5555-555555555555', 'a9999999-9999-9999-9999-999999999999', 120000, 'A cement run',  'a3333333-3333-3333-3333-333333333333', 'idem-exp-a-1'),
  ('b1b1b1b1-0000-0000-0000-0000000000b1', 'b6666666-6666-6666-6666-666666666666', 'b9999999-9999-9999-9999-999999999999', 130000, 'B cement run',  'b4444444-4444-4444-4444-444444444444', 'idem-exp-b-1');

INSERT INTO material_transactions (id, project_id, material_id, type, quantity, created_by, idempotency_key) VALUES
  ('a2a2a2a2-0000-0000-0000-0000000000a1', 'a5555555-5555-5555-5555-555555555555', 'a7777777-7777-7777-7777-777777777777', 'IN', 100, 'a3333333-3333-3333-3333-333333333333', 'idem-mt-a-1'),
  ('b2b2b2b2-0000-0000-0000-0000000000b1', 'b6666666-6666-6666-6666-666666666666', 'b8888888-8888-8888-8888-888888888888', 'IN', 100, 'b4444444-4444-4444-4444-444444444444', 'idem-mt-b-1');

-- Daily reports
INSERT INTO daily_reports (id, project_id, report_date, submitted_by, work_summary, idempotency_key) VALUES
  ('a3a3a3a3-0000-0000-0000-0000000000a1', 'a5555555-5555-5555-5555-555555555555', CURRENT_DATE, 'a3333333-3333-3333-3333-333333333333', 'Org A work', 'idem-dr-a-1'),
  ('b3b3b3b3-0000-0000-0000-0000000000b1', 'b6666666-6666-6666-6666-666666666666', CURRENT_DATE, 'b4444444-4444-4444-4444-444444444444', 'Org B work', 'idem-dr-b-1');
