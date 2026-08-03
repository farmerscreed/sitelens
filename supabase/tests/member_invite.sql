-- ═══════════════════════════════════════════════════════════════════════════
-- Member administration — invite / list / deactivate. The dangerous parts.
--
-- Run as: psql -v ON_ERROR_STOP=1 -f supabase/tests/member_invite.sql "$DB_URL"
-- Exits non-zero (RAISE EXCEPTION) on any violation; prints PASS otherwise.
--
-- Same technique as rls_isolation.sql: SET LOCAL ROLE authenticated + set_config the
-- JWT claims to impersonate a user, call the SECURITY DEFINER fns, then read ground
-- truth as the table owner (RESET ROLE bypasses RLS). Idempotent — safe to re-run
-- against a seeded DB (fn_add_member upserts).
--
-- Covers: (1) admin can invite → membership lands in the CALLER's org only (cross-org
-- injection is structurally impossible — no org param); (2) re-invite is idempotent and
-- re-roles, no duplicate; (3) a non-admin member cannot invite or deactivate, but CAN
-- read the roster; (4) deactivate/reactivate works; (5) you cannot deactivate yourself.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  ORG_A       CONSTANT uuid := 'a0000000-0000-0000-0000-0000000000aa';
  ORG_B       CONSTANT uuid := 'b0000000-0000-0000-0000-0000000000bb';
  ADMIN_A     CONSTANT uuid := 'a1111111-1111-1111-1111-111111111111';
  ADMIN_A_MEM CONSTANT uuid := 'a3333333-3333-3333-3333-333333333333';
  FRIEND      CONSTANT uuid := 'c1c1c1c1-0000-0000-0000-0000000000c1';
  ENGINEER    CONSTANT uuid := 'c2c2c2c2-0000-0000-0000-0000000000c2';

  claims_admin CONSTANT text := format(
    '{"role":"authenticated","sub":"%s","active_org_id":"%s"}', ADMIN_A, ORG_A);
  claims_eng   CONSTANT text := format(
    '{"role":"authenticated","sub":"%s","active_org_id":"%s"}', ENGINEER, ORG_A);

  v_friend_mem uuid;
  v_role       text;
  v_active     bool;
  v_deact      timestamptz;
  n            int;
  raised       bool;
  fails        int := 0;
BEGIN
  -- ── 1. Admin invites a member ─────────────────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  v_friend_mem := fn_add_member(FRIEND, 'friend@test.com', 'Test Friend', 'engineer');
  RESET ROLE;

  -- Membership must exist in Org A with the requested role, and NOWHERE else.
  SELECT count(*) INTO n FROM memberships WHERE user_id = FRIEND AND org_id = ORG_A;
  IF n <> 1 THEN RAISE WARNING 'invite: expected 1 Org-A membership, got %', n; fails := fails + 1; END IF;
  SELECT count(*) INTO n FROM memberships WHERE user_id = FRIEND AND org_id <> ORG_A;
  IF n <> 0 THEN RAISE WARNING 'CROSS-ORG: invite leaked % membership(s) outside caller org', n; fails := fails + 1; END IF;
  SELECT role::text, is_active INTO v_role, v_active FROM memberships WHERE id = v_friend_mem;
  IF v_role <> 'engineer' OR NOT v_active THEN RAISE WARNING 'invite: wrong role/active (%/%)', v_role, v_active; fails := fails + 1; END IF;
  -- Identity row created with email.
  SELECT count(*) INTO n FROM app_users WHERE id = FRIEND AND email = 'friend@test.com';
  IF n <> 1 THEN RAISE WARNING 'invite: app_users row missing/without email'; fails := fails + 1; END IF;

  -- ── 2. Re-invite is idempotent and re-roles (no duplicate) ────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  PERFORM fn_add_member(FRIEND, 'friend@test.com', 'Test Friend', 'client');
  RESET ROLE;
  SELECT count(*) INTO n FROM memberships WHERE user_id = FRIEND AND org_id = ORG_A;
  IF n <> 1 THEN RAISE WARNING 'idempotency: re-invite duplicated membership (% rows)', n; fails := fails + 1; END IF;
  SELECT role::text INTO v_role FROM memberships WHERE id = v_friend_mem;
  IF v_role <> 'client' THEN RAISE WARNING 'idempotency: role not updated on re-invite (%)', v_role; fails := fails + 1; END IF;

  -- Setup for the non-admin checks: admin adds an engineer.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  PERFORM fn_add_member(ENGINEER, 'eng@test.com', 'Site Eng', 'engineer');
  RESET ROLE;

  -- ── 3. A non-admin member cannot invite or deactivate ─────────────────────
  raised := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', claims_eng, true);
    PERFORM fn_add_member('c3333333-0000-0000-0000-0000000000c3', 'x@test.com', 'X', 'client');
  EXCEPTION WHEN others THEN raised := true;
  END;
  RESET ROLE;
  IF NOT raised THEN RAISE WARNING 'PRIVILEGE: a non-admin was allowed to invite'; fails := fails + 1; END IF;

  raised := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', claims_eng, true);
    PERFORM fn_set_member_active(v_friend_mem, false);
  EXCEPTION WHEN others THEN raised := true;
  END;
  RESET ROLE;
  IF NOT raised THEN RAISE WARNING 'PRIVILEGE: a non-admin was allowed to deactivate'; fails := fails + 1; END IF;

  -- ...but a non-admin member CAN read the roster (benign).
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_eng, true);
  SELECT count(*) INTO n FROM fn_org_members();
  RESET ROLE;
  IF n < 3 THEN RAISE WARNING 'roster: member should see >=3 rows, saw %', n; fails := fails + 1; END IF;

  -- ── 4. Admin deactivates then reactivates ─────────────────────────────────
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  PERFORM fn_set_member_active(v_friend_mem, false);
  RESET ROLE;
  SELECT is_active, deactivated_at INTO v_active, v_deact FROM memberships WHERE id = v_friend_mem;
  IF v_active OR v_deact IS NULL THEN RAISE WARNING 'deactivate: not applied (active=%, deact=%)', v_active, v_deact; fails := fails + 1; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims', claims_admin, true);
  PERFORM fn_set_member_active(v_friend_mem, true);
  RESET ROLE;
  SELECT is_active, deactivated_at INTO v_active, v_deact FROM memberships WHERE id = v_friend_mem;
  IF NOT v_active OR v_deact IS NOT NULL THEN RAISE WARNING 'reactivate: not applied (active=%, deact=%)', v_active, v_deact; fails := fails + 1; END IF;

  -- ── 5. You cannot deactivate your own membership (lock-out guard) ──────────
  raised := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM set_config('request.jwt.claims', claims_admin, true);
    PERFORM fn_set_member_active(ADMIN_A_MEM, false);
  EXCEPTION WHEN others THEN raised := true;
  END;
  RESET ROLE;
  IF NOT raised THEN RAISE WARNING 'LOCKOUT: admin was allowed to deactivate themselves'; fails := fails + 1; END IF;
  SELECT is_active INTO v_active FROM memberships WHERE id = ADMIN_A_MEM;
  IF NOT v_active THEN RAISE WARNING 'LOCKOUT: admin ended up deactivated'; fails := fails + 1; END IF;

  IF fails > 0 THEN
    RAISE EXCEPTION 'member_invite FAILED: % violation(s)', fails;
  END IF;
  RAISE NOTICE 'member_invite PASS: invite/idempotency/privilege/deactivate/lockout all green.';
END $$;
