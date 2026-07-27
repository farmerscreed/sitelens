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
-- Session-scoped temp table (no ON COMMIT DROP: psql autocommits each statement,
-- which would drop it before the INSERT). It vanishes when the session ends.
DROP TABLE IF EXISTS _rls_matrix;
CREATE TEMP TABLE _rls_matrix (tbl text, col text, a_val text, b_val text);
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
  -- Matrix captured into arrays BEFORE switching role: the temp table is owned by
  -- postgres and would not be readable as `authenticated`, so we read it once here.
  tbls  text[];
  cols  text[];
  avs   text[];
  bvs   text[];
  i        int;
  own_cnt  int;
  other_cnt int;
  leaks    int := 0;
  checks   int := 0;
BEGIN
  SELECT array_agg(tbl ORDER BY tbl), array_agg(col ORDER BY tbl),
         array_agg(a_val ORDER BY tbl), array_agg(b_val ORDER BY tbl)
    INTO tbls, cols, avs, bvs FROM _rls_matrix;

  -- ─── Perspective: Org A ───────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_a::text, true);
  FOR i IN 1 .. array_length(tbls,1) LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', tbls[i], cols[i], avs[i]) INTO own_cnt;
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', tbls[i], cols[i], bvs[i]) INTO other_cnt;
    checks := checks + 2;
    IF other_cnt <> 0 THEN
      RAISE WARNING 'LEAK: Org A can see % row(s) of Org B in %.%', other_cnt, tbls[i], cols[i];
      leaks := leaks + 1;
    END IF;
    IF own_cnt <> 1 THEN
      RAISE WARNING 'VISIBILITY: Org A should see its own % row but saw % (positive control failed)', tbls[i], own_cnt;
      leaks := leaks + 1;
    END IF;
  END LOOP;
  RESET ROLE;

  -- ─── Perspective: Org B ───────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_b::text, true);
  FOR i IN 1 .. array_length(tbls,1) LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', tbls[i], cols[i], bvs[i]) INTO own_cnt;
    EXECUTE format('SELECT count(*) FROM %I WHERE %I::text = %L', tbls[i], cols[i], avs[i]) INTO other_cnt;
    checks := checks + 2;
    IF other_cnt <> 0 THEN
      RAISE WARNING 'LEAK: Org B can see % row(s) of Org A in %.%', other_cnt, tbls[i], cols[i];
      leaks := leaks + 1;
    END IF;
    IF own_cnt <> 1 THEN
      RAISE WARNING 'VISIBILITY: Org B should see its own % row but saw % (positive control failed)', tbls[i], own_cnt;
      leaks := leaks + 1;
    END IF;
  END LOOP;
  RESET ROLE;

  -- ─── Anon sees nothing ────────────────────────────
  -- Pass if anon reads 0 rows (RLS: current_org_id() is NULL) OR is blocked at the
  -- privilege layer (no SELECT grant to anon at all — tighter, and what we do here:
  -- the portal reads via a SECURITY DEFINER function, never as anon directly).
  SET LOCAL ROLE anon;
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  checks := checks + 1;
  BEGIN
    EXECUTE 'SELECT count(*) FROM organizations' INTO other_cnt;
    IF other_cnt <> 0 THEN
      RAISE WARNING 'LEAK: anon can see % organization row(s)', other_cnt;
      leaks := leaks + 1;
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'anon blocked at privilege layer (no grant) — blind, as intended';
  END;
  RESET ROLE;

  IF leaks > 0 THEN
    RAISE EXCEPTION 'AC-6 FAILED: % isolation violation(s) across % checks', leaks, checks;
  END IF;
  RAISE NOTICE 'AC-6 PASS (direct DB): % checks, 0 leaks. Org A/B fully isolated; anon blind.', checks;
END $$;
