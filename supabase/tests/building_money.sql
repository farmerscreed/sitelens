-- ═══════════════════════════════════════════════════════════════════════════
-- Building money: budget snapshot is a PHOTOGRAPH (idempotent; price changes
-- later don't rewrite it); building_money computes earned/remaining/forecast;
-- building_finish_takeoff = remaining work → materials minus store.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  mat_cement uuid := 'a7777777-7777-7777-7777-777777777777';  -- bag @ 9500 (seed)
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  asm uuid; typ uuid; stg uuid; imp uuid; r1 uuid; wi uuid;
  ph uuid; ba uuid; bld uuid; snap1 uuid; snap2 uuid;
  q numeric; q2 numeric; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  asm := fn_upsert_assembly(org_a, 'BM Concrete', 'm3', 'concrete', '1:2:4', 1.54, 3000, NULL, NULL,
    jsonb_build_array(jsonb_build_object('material_id', mat_cement, 'qty_per_unit', 7, 'unit', 'bag', 'waste_factor', 1)));
  typ := fn_create_building_type(org_a, 'BM Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Frame', 1);
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, '[{"raw_text":"Concrete columns","parsed_qty":"10","parsed_unit":"m3","parsed_rate":"195000","row_kind":"item","suggested_kind":"composite"}]');
  SELECT id INTO r1 FROM boq_import_rows WHERE import_id = imp;
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', r1, 'stage_id', stg, 'kind', 'composite', 'assembly_id', asm)));
  SELECT id INTO wi FROM type_work_items WHERE building_type_id = typ;
  ph := fn_create_phase(proj, 'BM Phase', 1);
  ba := fn_create_batch(proj, 'BM Batch', ph, 1);
  PERFORM fn_create_buildings(typ, 1, proj, ba, ph, 'BM');
  SELECT id INTO bld FROM buildings WHERE project_id = proj AND building_type_id = typ LIMIT 1;

  -- Snapshot: 10 × (7×9500 + 3000) = 695,000. Idempotent.
  snap1 := fn_snapshot_building_budget(bld);
  snap2 := fn_snapshot_building_budget(bld);
  IF snap1 <> snap2 THEN RAISE WARNING 'snapshot not idempotent'; fails:=fails+1; END IF;
  SELECT budget INTO q FROM building_money WHERE building_id = bld;
  IF q <> 695000 THEN RAISE WARNING 'budget=% (expected 695000)', q; fails:=fails+1; END IF;

  -- The photograph survives a later price change (recipe re-prices; photo doesn't).
  PERFORM fn_set_material_price(org_a, mat_cement, 12000);
  SELECT budget INTO q FROM building_money WHERE building_id = bld;
  IF q <> 695000 THEN RAISE WARNING 'budget rewrote itself after price change (%)', q; fails:=fails+1; END IF;

  -- Work done 4 of 10 → earned 4×87,000 (new price) ; remaining 6×87,000; forecast = remaining (no spend logged).
  PERFORM fn_log_work_done(bld, wi, 4, 'idem-bm-1');
  SELECT earned, remaining, forecast INTO q, q2, q FROM building_money WHERE building_id = bld;
  SELECT earned INTO q FROM building_money WHERE building_id = bld;
  IF q <> 4 * 87000 THEN RAISE WARNING 'earned=% (expected 348000)', q; fails:=fails+1; END IF;
  SELECT remaining INTO q FROM building_money WHERE building_id = bld;
  IF q <> 6 * 87000 THEN RAISE WARNING 'remaining=% (expected 522000)', q; fails:=fails+1; END IF;
  SELECT forecast INTO q FROM building_money WHERE building_id = bld;
  IF q <> 6 * 87000 THEN RAISE WARNING 'forecast=% (expected 522000, no spend yet)', q; fails:=fails+1; END IF;

  -- Finish list: 6 m³ left × 7 bags = 42 bags of cement, store empty.
  SELECT qty_needed, in_store INTO q, q2 FROM building_finish_takeoff
   WHERE building_id = bld AND material_id = mat_cement;
  IF q <> 42 THEN RAISE WARNING 'finish qty=% (expected 42 bags)', q; fails:=fails+1; END IF;
  IF q2 <> 0 THEN RAISE WARNING 'in_store=% (expected 0)', q2; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'BUILDING-MONEY FAILED: %', fails; END IF;
  RAISE NOTICE 'BUILDING-MONEY PASS: photo idempotent + immune to price change; earned/remaining/forecast; finish buy list.';
END $$;
ROLLBACK;
SELECT 'Building money: PASS' AS result;
