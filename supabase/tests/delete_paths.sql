-- ═══════════════════════════════════════════════════════════════════════════
-- Delete & edit paths: import delete (guarded cascade + recipe recompute),
-- work-item delete/move (group upsert), building delete (history refused),
-- recipe delete (buildings/planner refused, then full cascade), authz.
-- Financial history must be UNDELETABLE by these paths.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/delete_paths.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  prj_a uuid := 'a5555555-5555-5555-5555-555555555555';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  typ uuid; stg uuid; stg2 uuid; imp uuid; bld uuid; txn uuid := gen_random_uuid();
  r1 uuid; r2 uuid; r3 uuid; wi1 uuid;
  n int; q numeric; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- ── setup: type + stages + confirmed import (2 supply lines, 1 composite) ──
  typ  := fn_create_building_type(org_a, 'Deletable Type', 'g+3');
  stg  := fn_add_type_stage(typ, 'Substructure', 1);
  stg2 := fn_add_type_stage(typ, 'Frame', 2);
  imp  := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, jsonb_build_array(
    jsonb_build_object('raw_text','Cement bags A','parsed_qty','2','parsed_unit','bag','parsed_rate','9000','row_kind','item','suggested_kind','material_supply','row_no','1'),
    jsonb_build_object('raw_text','Cement bags B','parsed_qty','3','parsed_unit','bag','parsed_rate','9000','row_kind','item','suggested_kind','material_supply','row_no','2'),
    jsonb_build_object('raw_text','C20 concrete in pads','parsed_qty','10','parsed_unit','m3','parsed_rate','180000','row_kind','item','suggested_kind','composite','row_no','3')));
  SELECT id INTO r1 FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Cement bags A';
  SELECT id INTO r2 FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Cement bags B';
  SELECT id INTO r3 FROM boq_import_rows WHERE import_id = imp AND raw_text = 'C20 concrete in pads';
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', r1, 'stage_id', stg, 'kind', 'material_supply', 'material_id', mat_a, 'quantity', 2, 'unit', 'bag'),
    jsonb_build_object('row_id', r2, 'stage_id', stg, 'kind', 'material_supply', 'material_id', mat_a, 'quantity', 3, 'unit', 'bag'),
    jsonb_build_object('row_id', r3, 'stage_id', stg, 'kind', 'composite', 'quantity', 10, 'unit', 'm3')));
  SELECT quantity INTO q FROM type_boq_items WHERE building_type_id = typ AND stage_id = stg AND material_id = mat_a;
  IF q <> 5 THEN RAISE WARNING 'setup: summed recipe qty=% (expected 5)', q; fails:=fails+1; END IF;

  -- ── 1. confirmed import refuses deletion without the cascade flag ──────────
  BEGIN
    PERFORM fn_delete_boq_import(imp);
    RAISE WARNING 'confirmed import deleted without cascade consent'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── 2. work-item edit: move a supply line to another stage → groups upsert ─
  SELECT id INTO wi1 FROM type_work_items WHERE source_row_id = r1;
  PERFORM fn_update_work_item(wi1, NULL, NULL, NULL, false, false, NULL, stg2, false);
  SELECT quantity INTO q FROM type_boq_items WHERE building_type_id = typ AND stage_id = stg AND material_id = mat_a;
  IF q <> 3 THEN RAISE WARNING 'move: old group qty=% (expected 3)', q; fails:=fails+1; END IF;
  SELECT quantity INTO q FROM type_boq_items WHERE building_type_id = typ AND stage_id = stg2 AND material_id = mat_a;
  IF q IS DISTINCT FROM 2 THEN RAISE WARNING 'move: new group qty=% (expected 2 — upsert missing)', q; fails:=fails+1; END IF;

  -- ── 3. work-item delete rebuilds its group ─────────────────────────────────
  PERFORM fn_delete_work_item(wi1);
  SELECT COUNT(*) INTO n FROM type_boq_items WHERE building_type_id = typ AND stage_id = stg2 AND material_id = mat_a;
  IF n <> 0 THEN RAISE WARNING 'delete: emptied group still has a recipe row'; fails:=fails+1; END IF;

  -- ── 4. cascade delete of the import removes work items + recipe rows ───────
  PERFORM fn_delete_boq_import(imp, true);
  SELECT COUNT(*) INTO n FROM boq_imports WHERE id = imp;
  IF n <> 0 THEN RAISE WARNING 'import row survived deletion'; fails:=fails+1; END IF;
  SELECT COUNT(*) INTO n FROM type_work_items WHERE building_type_id = typ;
  IF n <> 0 THEN RAISE WARNING '% work item(s) survived the cascade', n; fails:=fails+1; END IF;
  SELECT COUNT(*) INTO n FROM type_boq_items WHERE building_type_id = typ AND material_id = mat_a;
  IF n <> 0 THEN RAISE WARNING 'recipe rows survived the cascade'; fails:=fails+1; END IF;

  -- ── 5. recipe delete refused while a building uses it; building delete ─────
  INSERT INTO buildings (org_id, project_id, building_type_id, code)
  VALUES (org_a, prj_a, typ, 'DEL-01') RETURNING id INTO bld;
  BEGIN
    PERFORM fn_delete_building_type(typ);
    RAISE WARNING 'recipe deleted while a building used it'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- building WITH financial history must refuse…
  PERFORM fn_log_material_txn(txn, prj_a, mat_a, 'IN', 5, 'del-k-1', p_building=>bld);
  BEGIN
    PERFORM fn_delete_building(bld);
    RAISE WARNING 'building with material movements was deleted'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  -- …void the movement (through the real void path): STILL refused — voided
  -- history is history.
  PERFORM fn_void_material_txn(txn, 'test scrub');
  BEGIN
    PERFORM fn_delete_building(bld);
    RAISE WARNING 'building with voided history was deleted'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  DELETE FROM material_transactions WHERE building_id = bld;  -- test-only scrub (superuser)

  PERFORM fn_delete_building(bld);
  SELECT COUNT(*) INTO n FROM buildings WHERE id = bld;
  IF n <> 0 THEN RAISE WARNING 'clean building not deleted'; fails:=fails+1; END IF;

  -- ── 6. recipe delete cascades once nothing uses it ─────────────────────────
  PERFORM fn_delete_building_type(typ);
  SELECT COUNT(*) INTO n FROM building_types WHERE id = typ;
  IF n <> 0 THEN RAISE WARNING 'recipe survived deletion'; fails:=fails+1; END IF;
  SELECT COUNT(*) INTO n FROM type_stages WHERE building_type_id = typ;
  IF n <> 0 THEN RAISE WARNING 'stages survived recipe deletion'; fails:=fails+1; END IF;

  -- ── 7. authz: another org's admin can delete nothing here ──────────────────
  typ := fn_create_building_type(org_a, 'Authz Type', 'g+3');
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_delete_boq_import(imp);
    RAISE WARNING 'org B deleted org A''s import'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    PERFORM fn_delete_building_type(typ);
    RAISE WARNING 'org B deleted org A''s recipe'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'DELETE PATHS FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'Delete paths PASS: guarded import cascade + recompute; move/delete work items; history-protected building; recipe cascade; cross-org gates.';
END $$;
ROLLBACK;
SELECT 'Delete paths: PASS' AS result;
