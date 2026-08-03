-- ═══════════════════════════════════════════════════════════════════════════
-- Field ops (DECISIONS #65): an ENGINEER can complete a stage from the field —
-- it lands instantly, labelled (completed_by + completed_source='field',
-- approved_by NULL); a manager tick stays approved; fn_reopen_stage (manager-
-- only) reverts a wrong tick and rewinds the building; the client role and
-- cross-org are blocked; the engineer materials IN/OUT contract (member-gated,
-- balance-guarded) is locked. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- An engineer and a client-role member in Org A (idempotent with g_hardening's).
INSERT INTO app_users (id, full_name, phone)
VALUES ('e1111111-1111-1111-1111-111111111111', 'Eng A', '+2348000000009')
ON CONFLICT (id) DO NOTHING;
INSERT INTO memberships (id, org_id, user_id, role)
VALUES ('e2222222-2222-2222-2222-222222222222',
        'a0000000-0000-0000-0000-0000000000aa',
        'e1111111-1111-1111-1111-111111111111', 'engineer')
ON CONFLICT (id) DO NOTHING;
INSERT INTO app_users (id, full_name, phone)
VALUES ('c1111111-1111-1111-1111-111111111111', 'Client A', '+2348000000010')
ON CONFLICT (id) DO NOTHING;
INSERT INTO memberships (id, org_id, user_id, role)
VALUES ('c2222222-2222-2222-2222-222222222222',
        'a0000000-0000-0000-0000-0000000000aa',
        'c1111111-1111-1111-1111-111111111111', 'client')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  org_a  uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj   uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';  -- admin of org A
  eng    uuid := 'e1111111-1111-1111-1111-111111111111';
  eng_mem uuid := 'e2222222-2222-2222-2222-222222222222';
  cli    uuid := 'c1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';  -- org B member
  typ uuid; s1 uuid; s2 uuid; bld uuid; mat uuid;
  v uuid; t text; n numeric; fails int := 0;
BEGIN
  -- Admin sets up a type with 2 stages, one building, one material.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Field Type', 'terrace');
  s1 := fn_add_type_stage(typ, 'Foundation', 1);
  s2 := fn_add_type_stage(typ, 'Roof', 2);
  PERFORM fn_create_buildings(typ, 1, proj, NULL, NULL, 'FLD');
  SELECT id INTO bld FROM buildings WHERE project_id=proj AND building_type_id=typ LIMIT 1;
  mat := fn_upsert_material(org_a, 'Field Cement', 'bag');

  -- ── engineer completes a stage FROM THE FIELD: instant + labelled ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng)::text, true);
  PERFORM fn_complete_stage(bld, s1, 'field');
  SELECT status INTO t FROM building_stage_progress WHERE building_id=bld AND stage_id=s1;
  IF t <> 'done' THEN RAISE WARNING 'field tick: status=% (exp done)', t; fails:=fails+1; END IF;
  SELECT completed_source INTO t FROM building_stage_progress WHERE building_id=bld AND stage_id=s1;
  IF t <> 'field' THEN RAISE WARNING 'field tick: source=% (exp field)', t; fails:=fails+1; END IF;
  SELECT completed_by INTO v FROM building_stage_progress WHERE building_id=bld AND stage_id=s1;
  IF v <> eng_mem THEN RAISE WARNING 'field tick: completed_by=% (exp engineer)', v; fails:=fails+1; END IF;
  SELECT approved_by INTO v FROM building_stage_progress WHERE building_id=bld AND stage_id=s1;
  IF v IS NOT NULL THEN RAISE WARNING 'field tick: approved_by set (must stay NULL)'; fails:=fails+1; END IF;
  SELECT current_stage_id INTO v FROM buildings WHERE id=bld;
  IF v <> s2 THEN RAISE WARNING 'board did not advance to Roof'; fails:=fails+1; END IF;

  -- ── engineer materials IN/OUT (already member-gated — lock the contract) ──
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'IN', 100, 'fld-in-1');
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'OUT', 40, 'fld-out-1', p_building => bld, p_stage => s2);
  SELECT balance INTO n FROM material_balances WHERE project_id=proj AND material_id=mat;
  IF n <> 60 THEN RAISE WARNING 'engineer IN/OUT balance=% (exp 60)', n; fails:=fails+1; END IF;
  BEGIN PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'OUT', 999, 'fld-out-2', p_building => bld);
    RAISE WARNING 'negative stock accepted from the field'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── engineer cannot reopen (manager-only revert) ──
  BEGIN PERFORM fn_reopen_stage(bld, s1);
    RAISE WARNING 'engineer reopened a stage'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- ── client role blocked from completing ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', cli)::text, true);
  BEGIN PERFORM fn_complete_stage(bld, s2, 'field');
    RAISE WARNING 'client role completed a stage'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- ── cross-org blocked ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN PERFORM fn_complete_stage(bld, s2, 'field');
    RAISE WARNING 'cross-org completed a stage'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- ── manager tick stays approved; web is the default source ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  PERFORM fn_complete_stage(bld, s2);
  SELECT completed_source INTO t FROM building_stage_progress WHERE building_id=bld AND stage_id=s2;
  IF t <> 'web' THEN RAISE WARNING 'manager tick: source=% (exp web)', t; fails:=fails+1; END IF;
  SELECT approved_by INTO v FROM building_stage_progress WHERE building_id=bld AND stage_id=s2;
  IF v IS NULL THEN RAISE WARNING 'manager tick: approved_by not set'; fails:=fails+1; END IF;
  SELECT status INTO t FROM buildings WHERE id=bld;
  IF t <> 'done' THEN RAISE WARNING 'building not done after both stages'; fails:=fails+1; END IF;

  -- ── manager reverts: stage back to in_progress, building rewound ──
  PERFORM fn_reopen_stage(bld, s2);
  SELECT status INTO t FROM building_stage_progress WHERE building_id=bld AND stage_id=s2;
  IF t <> 'in_progress' THEN RAISE WARNING 'reopen: status=% (exp in_progress)', t; fails:=fails+1; END IF;
  SELECT completed_by INTO v FROM building_stage_progress WHERE building_id=bld AND stage_id=s2;
  IF v IS NOT NULL THEN RAISE WARNING 'reopen: provenance not cleared'; fails:=fails+1; END IF;
  SELECT current_stage_id INTO v FROM buildings WHERE id=bld;
  IF v <> s2 THEN RAISE WARNING 'reopen: current stage not rewound to Roof'; fails:=fails+1; END IF;
  SELECT status INTO t FROM buildings WHERE id=bld;
  IF t <> 'in_progress' THEN RAISE WARNING 'reopen: building status=% (exp in_progress)', t; fails:=fails+1; END IF;

  -- ── the field can re-complete after a revert ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng)::text, true);
  PERFORM fn_complete_stage(bld, s2, 'field');
  SELECT status INTO t FROM buildings WHERE id=bld;
  IF t <> 'done' THEN RAISE WARNING 're-complete after revert failed'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'FIELD OPS FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'FIELD OPS PASS: engineer tick instant + labelled from field (approved_by NULL); materials member-gated + balance guard; client/cross-org blocked; manager tick approved; reopen reverts + rewinds; re-complete works.';
END $$;
ROLLBACK;
SELECT 'Field ops: PASS' AS result;
