-- ═══════════════════════════════════════════════════════════════════════════
-- M5 — AC-9: a building's stage overrun (used > required) flags AT COMPLETION,
-- per stage ("at the pour"). Also the building_req_vs_actual view. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
INSERT INTO projects (id, org_id, name, created_by)
VALUES ('c9000000-0000-0000-0000-0000000000c9', 'a0000000-0000-0000-0000-0000000000aa',
        'AC9 Estate', 'a1111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj uuid := 'c9000000-0000-0000-0000-0000000000c9';
  mat  uuid := 'a7777777-7777-7777-7777-777777777777';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  typ uuid; stg uuid; b1 uuid; b2 uuid; n int; fails int := 0; ov numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  typ := fn_create_building_type(org_a, 'AC9 Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Foundation', 1);
  PERFORM fn_set_type_boq_item(typ, stg, mat, 10, 'bag');   -- required 10 for this stage

  PERFORM fn_create_buildings(typ, 2, proj, NULL, NULL, 'C');
  SELECT id INTO b1 FROM buildings WHERE project_id=proj AND code='C001';
  SELECT id INTO b2 FROM buildings WHERE project_id=proj AND code='C002';

  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'IN', 40, 'ac9-in');   -- stock

  -- Building 1: use 15 (> required 10) on the stage, then complete → OVERRUN flag.
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'OUT', 15, 'ac9-out-1', p_building=>b1, p_stage=>stg);
  PERFORM fn_complete_stage(b1, stg);
  SELECT count(*) INTO n FROM audit_log
   WHERE action='stage_overrun' AND entity_id=b1 AND (after->>'material')::uuid=mat;
  IF n < 1 THEN RAISE WARNING 'overrun NOT flagged at completion'; fails:=fails+1; END IF;
  IF (SELECT (after->>'overrun')::numeric FROM audit_log WHERE action='stage_overrun' AND entity_id=b1 LIMIT 1) <> 5 THEN
    RAISE WARNING 'overrun amount wrong'; fails:=fails+1; END IF;

  -- building_req_vs_actual view: required 10, consumed 15, overrun 5.
  SELECT overrun INTO ov FROM building_req_vs_actual WHERE building_id=b1 AND material_id=mat;
  IF ov <> 5 THEN RAISE WARNING 'view overrun=% (exp 5)', ov; fails:=fails+1; END IF;

  -- Building 2: use 8 (< required 10), complete → NO overrun flag.
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'OUT', 8, 'ac9-out-2', p_building=>b2, p_stage=>stg);
  PERFORM fn_complete_stage(b2, stg);
  SELECT count(*) INTO n FROM audit_log WHERE action='stage_overrun' AND entity_id=b2;
  IF n <> 0 THEN RAISE WARNING 'false overrun flag on under-use'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'AC-9 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-9 PASS: used>required flagged at completion (overrun 5); under-use not flagged; view correct.';
END $$;
ROLLBACK;
SELECT 'AC-9 stage overrun: PASS' AS result;
