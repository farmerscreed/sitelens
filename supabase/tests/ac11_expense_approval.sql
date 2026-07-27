-- ═══════════════════════════════════════════════════════════════════════════
-- M5 — AC-11: expenses above threshold cannot be recorded as SPENT without
-- approval. Unapproved = committed (status 'pending'). Approver authority: > ₦250k
-- needs Admin; engineers cannot approve. Void is Admin-only. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
-- A PM and an engineer in Org A.
INSERT INTO app_users (id, full_name, phone) VALUES
  ('fa000000-0000-0000-0000-0000000000f1', 'PM A',  '+2348000000010'),
  ('fb000000-0000-0000-0000-0000000000f2', 'Eng A2','+2348000000011');
INSERT INTO memberships (id, org_id, user_id, role) VALUES
  ('fa000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-0000000000aa', 'fa000000-0000-0000-0000-0000000000f1', 'pm'),
  ('fb000000-0000-0000-0000-0000000000bb', 'a0000000-0000-0000-0000-0000000000aa', 'fb000000-0000-0000-0000-0000000000f2', 'engineer');

DO $$
DECLARE
  proj uuid := 'a5555555-5555-5555-5555-555555555555';
  bl   uuid := 'a9999999-9999-9999-9999-999999999999';  -- seeded budget line in projA
  admin_u uuid := 'a1111111-1111-1111-1111-111111111111';
  pm_u    uuid := 'fa000000-0000-0000-0000-0000000000f1';
  eng_u   uuid := 'fb000000-0000-0000-0000-0000000000f2';
  e100 uuid := gen_random_uuid(); e300 uuid := gen_random_uuid();
  st text; fails int := 0;
BEGIN
  -- Engineer records a ₦100k expense → PENDING (committed, not spent).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng_u)::text, true);
  PERFORM fn_create_expense(e100, proj, bl, 100000, 'exp-100', p_description=>'cement run');
  SELECT status INTO st FROM expenses WHERE id=e100;
  IF st <> 'pending' THEN RAISE WARNING 'new expense not pending (%)', st; fails:=fails+1; END IF;

  -- Engineer cannot approve.
  BEGIN PERFORM fn_approve_expense(e100); RAISE WARNING 'engineer approved an expense'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- PM approves ≤ ₦250k.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pm_u)::text, true);
  PERFORM fn_approve_expense(e100);
  IF (SELECT status FROM expenses WHERE id=e100) <> 'approved' THEN RAISE WARNING 'PM approval failed'; fails:=fails+1; END IF;

  -- A ₦300k expense (> ₦250k) needs Admin — PM cannot approve.
  PERFORM fn_create_expense(e300, proj, bl, 300000, 'exp-300', p_description=>'big buy');
  BEGIN PERFORM fn_approve_expense(e300); RAISE WARNING 'PM approved > 250k'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Admin approves the ₦300k.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', admin_u)::text, true);
  PERFORM fn_approve_expense(e300);
  IF (SELECT status FROM expenses WHERE id=e300) <> 'approved' THEN RAISE WARNING 'admin approval of 300k failed'; fails:=fails+1; END IF;

  -- Void: PM cannot; Admin can.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', pm_u)::text, true);
  BEGIN PERFORM fn_void_expense(e100, 'dup'); RAISE WARNING 'PM voided an expense'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', admin_u)::text, true);
  PERFORM fn_void_expense(e100, 'duplicate entry');
  IF (SELECT status FROM expenses WHERE id=e100) <> 'voided' THEN RAISE WARNING 'admin void failed'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'AC-11 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-11 PASS: new expense pending; engineer cannot approve; PM approves <=250k; >250k needs Admin; void Admin-only.';
END $$;
ROLLBACK;
SELECT 'AC-11 expense approval: PASS' AS result;
