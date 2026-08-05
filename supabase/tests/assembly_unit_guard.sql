-- ═══════════════════════════════════════════════════════════════════════════
-- Assembly unit guard (the ₦82.96m incident): a mix whose OUTPUT unit differs
-- from the line's unit is refused at confirm AND at edit; matching units pass;
-- unknown units are tolerated (refuse only what is provably wrong).
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/assembly_unit_guard.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  typ uuid; imp uuid; r_m2 uuid; r_odd uuid; wi uuid;
  asm_m3 uuid; asm_m2 uuid;
  n int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  typ := fn_create_building_type(org_a, 'Guard Type', 'g+3');
  asm_m3 := fn_upsert_assembly(org_a, 'Guard concrete 1:2:4', 'm3', 'concrete', '1:2:4', 1.54, 23000, NULL, NULL,
    jsonb_build_array(jsonb_build_object('material_id', mat_a, 'qty_per_unit', 6.8, 'unit', 'bag')));
  asm_m2 := fn_upsert_assembly(org_a, 'Guard render 15mm', 'm2', 'render', '1:4', 1.3, 2700, NULL, NULL,
    jsonb_build_array(jsonb_build_object('material_id', mat_a, 'qty_per_unit', 0.26, 'unit', 'bag')));

  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, jsonb_build_array(
    jsonb_build_object('raw_text','External render 20mm','parsed_qty','500','parsed_unit','m2',
      'parsed_rate','7233','row_kind','item','suggested_kind','composite','row_no','1'),
    jsonb_build_object('raw_text','Odd-unit provisional works','parsed_qty','10','parsed_unit','mo',
      'parsed_rate','120000','row_kind','item','suggested_kind','composite','row_no','2')));
  SELECT id INTO r_m2  FROM boq_import_rows WHERE import_id = imp AND raw_text = 'External render 20mm';
  SELECT id INTO r_odd FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Odd-unit provisional works';

  -- 1. CONFIRM with a per-m³ mix on a m² line → refused.
  BEGIN
    PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
      jsonb_build_object('row_id', r_m2, 'kind', 'composite', 'assembly_id', asm_m3, 'quantity', 500, 'unit', 'm2')));
    RAISE WARNING 'per-m3 mix attached to m2 line at confirm'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 2. Matching unit passes; unknown unit ('mo') is tolerated even with a mix.
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', r_m2, 'kind', 'composite', 'assembly_id', asm_m2, 'quantity', 500, 'unit', 'm2'),
    jsonb_build_object('row_id', r_odd, 'kind', 'composite', 'assembly_id', asm_m3, 'quantity', 10, 'unit', 'mo')));
  SELECT COUNT(*) INTO n FROM type_work_items WHERE building_type_id = typ;
  IF n <> 2 THEN RAISE WARNING 'matching/unknown-unit confirm failed (% items)', n; fails:=fails+1; END IF;

  -- 3. EDIT: swapping the m² line onto the m³ mix → refused; kept on m² mix.
  SELECT id INTO wi FROM type_work_items WHERE source_row_id = r_m2;
  BEGIN
    PERFORM fn_update_work_item(wi, NULL, asm_m3, NULL, false, false, NULL, NULL, false);
    RAISE WARNING 'per-m3 mix attached to m2 line at edit'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT COUNT(*) INTO n FROM type_work_items WHERE id = wi AND assembly_id = asm_m2;
  IF n <> 1 THEN RAISE WARNING 'guarded edit corrupted the attachment'; fails:=fails+1; END IF;

  -- 4. Detaching (clear assembly) always allowed — the correction path.
  PERFORM fn_update_work_item(wi, NULL, NULL, NULL, false, true, NULL, NULL, false);
  SELECT COUNT(*) INTO n FROM type_work_items WHERE id = wi AND assembly_id IS NULL;
  IF n <> 1 THEN RAISE WARNING 'clear-assembly correction path broken'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'ASSEMBLY UNIT GUARD FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'Assembly unit guard PASS: refused at confirm + edit; match passes; unknown tolerated; detach works.';
END $$;
ROLLBACK;
SELECT 'Assembly unit guard: PASS' AS result;
