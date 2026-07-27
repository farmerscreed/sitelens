-- ═══════════════════════════════════════════════════════════════════════════
-- M1 · A0 test — access-token hook injects active_org_id, and fn_set_active_org
-- is authz-guarded. Run against the seeded M0 database.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/a0_token_hook.sql
-- RAISEs on any failure; prints PASS otherwise.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Part 1: default hook + authz (no rollback needed) ───────────────────────
DO $$
DECLARE
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  org_a  uuid := 'a0000000-0000-0000-0000-0000000000aa';
  org_b  uuid := 'b0000000-0000-0000-0000-0000000000bb';
  out    jsonb;
  fails  int := 0;
BEGIN
  -- Hook for user A → active_org_id = org A, role admin (single membership default).
  out := custom_access_token_hook(jsonb_build_object(
           'user_id', user_a,
           'claims', jsonb_build_object('sub', user_a, 'role', 'authenticated')));
  IF (out->'claims'->>'active_org_id')::uuid <> org_a THEN
    RAISE WARNING 'hook: user A active_org_id = % (expected org A)', out->'claims'->>'active_org_id'; fails := fails+1;
  END IF;
  IF out->'claims'->>'user_role' <> 'admin' THEN
    RAISE WARNING 'hook: user A user_role = % (expected admin)', out->'claims'->>'user_role'; fails := fails+1;
  END IF;

  -- Hook for user B → org B.
  out := custom_access_token_hook(jsonb_build_object(
           'user_id', user_b,
           'claims', jsonb_build_object('sub', user_b, 'role', 'authenticated')));
  IF (out->'claims'->>'active_org_id')::uuid <> org_b THEN
    RAISE WARNING 'hook: user B active_org_id = % (expected org B)', out->'claims'->>'active_org_id'; fails := fails+1;
  END IF;

  -- Existing claims are preserved.
  IF out->'claims'->>'sub' <> user_b::text THEN
    RAISE WARNING 'hook: dropped existing sub claim'; fails := fails+1;
  END IF;

  -- fn_set_active_org authz: acting as user A, switching to org B must be rejected
  -- (user A is not a member of org B).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  BEGIN
    PERFORM fn_set_active_org(org_b);
    RAISE WARNING 'fn_set_active_org: user A switching to org B should have raised'; fails := fails+1;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- expected
  END;

  -- Switching to own org A succeeds and records the active org.
  PERFORM fn_set_active_org(org_a);
  IF NOT EXISTS (SELECT 1 FROM active_org WHERE user_id = user_a) THEN
    RAISE WARNING 'fn_set_active_org: user A → org A did not record active_org'; fails := fails+1;
  END IF;

  -- fn_my_orgs lists exactly the caller's active orgs and flags the active one.
  IF (SELECT count(*) FROM fn_my_orgs()) <> 1 THEN
    RAISE WARNING 'fn_my_orgs: user A should see exactly 1 org, saw %', (SELECT count(*) FROM fn_my_orgs()); fails := fails+1;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM fn_my_orgs() WHERE org_id = org_a AND is_active_org) THEN
    RAISE WARNING 'fn_my_orgs: org A not flagged active for user A'; fails := fails+1;
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF fails > 0 THEN
    RAISE EXCEPTION 'A0 token-hook test FAILED: % assertion(s)', fails;
  END IF;
  RAISE NOTICE 'A0 PART 1 PASS: hook injects active_org_id/role; fn_set_active_org authz holds.';
END $$;

-- ── Part 2: org switch with a multi-org user (rolled back, no seed pollution) ─
BEGIN;
  -- Temporarily make user A also a PM of org B, and set it active.
  INSERT INTO memberships (id, org_id, user_id, role)
  VALUES ('a3333333-3333-3333-3333-3333333333ff',
          'b0000000-0000-0000-0000-0000000000bb',
          'a1111111-1111-1111-1111-111111111111', 'pm');
  INSERT INTO active_org (user_id, membership_id)
  VALUES ('a1111111-1111-1111-1111-111111111111', 'a3333333-3333-3333-3333-3333333333ff')
  ON CONFLICT (user_id) DO UPDATE SET membership_id = EXCLUDED.membership_id;

  DO $$
  DECLARE out jsonb;
  BEGIN
    out := custom_access_token_hook(jsonb_build_object(
             'user_id', 'a1111111-1111-1111-1111-111111111111',
             'claims', jsonb_build_object('sub', 'a1111111-1111-1111-1111-111111111111')));
    IF (out->'claims'->>'active_org_id')::uuid <> 'b0000000-0000-0000-0000-0000000000bb' THEN
      RAISE EXCEPTION 'A0 switch test FAILED: after switching active org to B, hook returned %',
        out->'claims'->>'active_org_id';
    END IF;
    IF out->'claims'->>'user_role' <> 'pm' THEN
      RAISE EXCEPTION 'A0 switch test FAILED: expected role pm for the org-B membership, got %',
        out->'claims'->>'user_role';
    END IF;
    RAISE NOTICE 'A0 PART 2 PASS: switching active org flips the injected claim (org B, role pm).';
  END $$;
ROLLBACK;

SELECT 'A0 token-hook: ALL PASS' AS result;
