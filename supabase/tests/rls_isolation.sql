-- ═══════════════════════════════════════════════════════════════════════════
-- AC-6 — RLS isolation test, DIRECT-DATABASE route.
-- "Org A cannot read a single row of org B by any route."
--
-- Run as: psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_isolation.sql "$DB_URL"
-- Exits non-zero (RAISE EXCEPTION) on ANY leak. Prints a PASS summary otherwise.
--
-- Why role-switching + set_config instead of pgTAP: RLS does not apply to the
-- table owner/superuser, so the test MUST run as the non-owner `authenticated`
-- role — the same role the API uses. pgTAP's bookkeeping tables are owned by
-- postgres and are not writable by `authenticated`, so we assert with plain
-- DO blocks that RAISE on failure. (DECISIONS.md #5)
-- ═══════════════════════════════════════════════════════════════════════════

-- (table, column, org-A value, org-B value) matrix of known seeded rows.
-- Under Org A's JWT: the A value must be visible (=1) and the B value hidden (=0).
-- Under Org B's JWT: the reverse.
CREATE TEMP TABLE _rls_matrix (tbl text, col text, a_val text, b_val text) ON COMMIT DROP;
INSERT INTO _rls_matrix VALUES
  ('organizations',         'id',          'a0000000-0000-0000-0000-0000000000aa', 'b0000000-0000-0000-0000-0000000000bb'),
  ('app_users',             'id',          'a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222'),
  ('memberships',           'id',          'a3333333-3333-3333-3333-333333333333', 'b4444444-4444-4444-4444-444444444444'),
  ('projects',              'id',          'a5555555-5555-5555-5555-555555555555', 'b6666666-6666-6666-6666-666666666666'),
  ('materials_catalog',     'id',          'a7777777-7777-7777-7777-777777777777', 'b8888888-8888-8888-8888-888888888888'),
  ('material_prices',       'material_id', 'a7777777-7777-7777-7777-777777777777', 'b8888888-8888-8888-8888-888888888888'),
  ('budget_lines',          'id',          'a9999999-9999-9999-9999-999999999999', 'b9999999-9999-9999-9999-999999999999'),
  ('building_types',        'id',          'aaaa0000-0000-0000-0000-0000000000a1', 'bbbb0000-0000-0000-0000-0000000000b1'),
  ('buildings',             'id',          'aabb0000-0000-0000-0000-0000000000a1', 'aabb0000-0000-0000-0000-0000000000b1'),
  ('expenses',              'id',          'a1a1a1a1-0000-0000-0000-0000000000a1', 'b1b1b1b1-0000-0000-0000-0000000000b1'),
  ('material_transactions', 'id',          'a2a2a2a2-0000-0000-0000-0000000000a1', 'b2b2b2b2-0000-0000-0000-0000000000b1'),
  ('daily_reports',         'id',          'a3a3a3a3-0000-0000-0000-0000000000a1', 'b3b3b3b3-0000-0000-0000-0000000000b1');

DO $$
DECLARE
  claims_a jsonb := '{"role":"authenticated","sub":"a1111111-1111-1111-1111-111111111111","active_org_id":"a0000000-0000-0000-0000-0000000000aa"}';
  claims_b jsonb := '{"role":"authenticated","sub":"b2222222-2222-2222-2222-222222222222","active_org_id":"b0000000-0000-0000-0000-0000000000bb"}';
  r        record;
  own_cnt  int;
  other_cnt int;
  leaks    int := 0;
  checks   int := 0;
BEGIN
  -- ─── Perspective: Org A ───────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_a::text, true);
  FOR r IN SELECT * FROM _rls_matrix LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', r.tbl, r.col, r.a_val) INTO own_cnt;
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', r.tbl, r.col, r.b_val) INTO other_cnt;
    checks := checks + 2;
    IF other_cnt <> 0 THEN
      RAISE WARNING 'LEAK: Org A can see % row(s) of Org B in %.%', other_cnt, r.tbl, r.col;
      leaks := leaks + 1;
    END IF;
    IF own_cnt <> 1 THEN
      RAISE WARNING 'VISIBILITY: Org A should see its own % row but saw % (positive control failed)', r.tbl, own_cnt;
      leaks := leaks + 1;
    END IF;
  END LOOP;
  RESET ROLE;

  -- ─── Perspective: Org B ───────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_b::text, true);
  FOR r IN SELECT * FROM _rls_matrix LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', r.tbl, r.col, r.b_val) INTO own_cnt;
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', r.tbl, r.col, r.a_val) INTO other_cnt;
    checks := checks + 2;
    IF other_cnt <> 0 THEN
      RAISE WARNING 'LEAK: Org B can see % row(s) of Org A in %.%', other_cnt, r.tbl, r.col;
      leaks := leaks + 1;
    END IF;
    IF own_cnt <> 1 THEN
      RAISE WARNING 'VISIBILITY: Org B should see its own % row but saw % (positive control failed)', r.tbl, own_cnt;
      leaks := leaks + 1;
    END IF;
  END LOOP;
  RESET ROLE;

  -- ─── Anon sees nothing (current_org_id() is NULL) ─
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  EXECUTE 'SELECT count(*) FROM organizations' INTO other_cnt;
  checks := checks + 1;
  IF other_cnt <> 0 THEN
    RAISE WARNING 'LEAK: anon can see % organization row(s)', other_cnt;
    leaks := leaks + 1;
  END IF;
  RESET ROLE;

  IF leaks > 0 THEN
    RAISE EXCEPTION 'AC-6 FAILED: % isolation violation(s) across % checks', leaks, checks;
  END IF;
  RAISE NOTICE 'AC-6 PASS (direct DB): % checks, 0 leaks. Org A/B fully isolated; anon blind.', checks;
END $$;
