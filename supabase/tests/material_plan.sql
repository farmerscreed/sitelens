-- ═══════════════════════════════════════════════════════════════════════════
-- Unified material plan (take-off + type_boq_items fallback):
--   • a composite work item's material (cement in concrete) is surfaced by the
--     take-off even though type_boq_items has NO row for it;
--   • per-building variance carries planned_total (full recipe) + required-to-date;
--   • per-batch procurement sums the plan across the batch's buildings;
--   • AC-9 overrun now flags a MIX-DERIVED material at stage completion;
--   • reorder advice is take-off sourced (includes the mix material).
-- Runs in BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
INSERT INTO projects (id, org_id, name, created_by)
VALUES ('d1000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000aa',
        'Plan Estate', 'a1111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'd1000000-0000-0000-0000-0000000000d1';
  cement uuid := 'a7777777-7777-7777-7777-777777777777';   -- bag @ 9500 (seed)
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  asm uuid; typ uuid; stg uuid; imp uuid; r1 uuid; wi uuid;
  ph uuid; ba uuid; b1 uuid; b2 uuid; n int; q numeric; adv jsonb; row jsonb; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Concrete mix: 7 bags cement per m³ (no waste). 10 m³ column → 70 bags of cement.
  asm := fn_upsert_assembly(org_a, 'MP Concrete', 'm3', 'concrete', '1:2:4', 1.54, 3000, NULL, NULL,
    jsonb_build_array(jsonb_build_object('material_id', cement, 'qty_per_unit', 7, 'unit', 'bag', 'waste_factor', 1)));
  typ := fn_create_building_type(org_a, 'MP Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Frame', 1);
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, '[{"raw_text":"Concrete columns","parsed_qty":"10","parsed_unit":"m3","parsed_rate":"195000","row_kind":"item","suggested_kind":"composite"}]');
  SELECT id INTO r1 FROM boq_import_rows WHERE import_id = imp;
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', r1, 'stage_id', stg, 'kind', 'composite', 'assembly_id', asm)));
  SELECT id INTO wi FROM type_work_items WHERE building_type_id = typ;

  -- The take-off surfaces cement (mix-derived); type_boq_items has NO cement row.
  SELECT count(*) INTO n FROM type_boq_items WHERE building_type_id = typ AND material_id = cement;
  IF n <> 0 THEN RAISE WARNING 'type_boq_items unexpectedly has the mix material (%)', n; fails:=fails+1; END IF;
  SELECT qty INTO q FROM type_material_plan WHERE building_type_id = typ AND material_id = cement;
  IF q <> 70 THEN RAISE WARNING 'type_material_plan cement=% (exp 70)', q; fails:=fails+1; END IF;

  ph := fn_create_phase(proj, 'MP Phase', 1);
  ba := fn_create_batch(proj, 'MP Batch', ph, 1);
  PERFORM fn_create_buildings(typ, 2, proj, ba, ph, 'MP');
  SELECT id INTO b1 FROM buildings WHERE project_id=proj AND code='MP001';
  SELECT id INTO b2 FROM buildings WHERE project_id=proj AND code='MP002';

  -- Per-building planned_total = full take-off (70).
  SELECT planned_total INTO q FROM building_req_vs_actual WHERE building_id=b1 AND material_id=cement;
  IF q <> 70 THEN RAISE WARNING 'b1 planned_total=% (exp 70)', q; fails:=fails+1; END IF;

  -- Per-batch procurement = 2 buildings × 70 = 140 planned.
  SELECT planned INTO q FROM batch_material_plan WHERE batch_id=ba AND material_id=cement;
  IF q <> 140 THEN RAISE WARNING 'batch planned=% (exp 140)', q; fails:=fails+1; END IF;

  -- Stock + issue: IN 100, OUT 80 to b1 on the Frame stage.
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, cement, 'IN', 100, 'mp-in');
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, cement, 'OUT', 80, 'mp-out', p_building=>b1, p_stage=>stg);

  SELECT consumed INTO q FROM building_req_vs_actual WHERE building_id=b1 AND material_id=cement;
  IF q <> 80 THEN RAISE WARNING 'b1 consumed=% (exp 80)', q; fails:=fails+1; END IF;

  -- Complete Frame → required-to-date 70, overrun 10; AC-9 flags the MIX-DERIVED material.
  PERFORM fn_complete_stage(b1, stg);
  SELECT overrun INTO q FROM building_req_vs_actual WHERE building_id=b1 AND material_id=cement;
  IF q <> 10 THEN RAISE WARNING 'b1 overrun=% (exp 10)', q; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM audit_log
   WHERE action='stage_overrun' AND entity_id=b1 AND (after->>'material')::uuid=cement;
  IF n < 1 THEN RAISE WARNING 'AC-9 did not flag mix-derived overrun'; fails:=fails+1; END IF;

  -- Batch consumed 80; remaining 60.
  SELECT consumed INTO q FROM batch_material_plan WHERE batch_id=ba AND material_id=cement;
  IF q <> 80 THEN RAISE WARNING 'batch consumed=% (exp 80)', q; fails:=fails+1; END IF;
  SELECT remaining INTO q FROM batch_material_plan WHERE batch_id=ba AND material_id=cement;
  IF q <> 60 THEN RAISE WARNING 'batch remaining=% (exp 60)', q; fails:=fails+1; END IF;

  -- Reorder advice (take-off sourced): required 140, consumed 80, stock 20, order 40.
  adv := fn_reorder_advice(proj);
  SELECT e INTO row FROM jsonb_array_elements(adv) e WHERE (e->>'material_id')::uuid = cement;
  IF (row->>'required')::numeric  <> 140 THEN RAISE WARNING 'reorder required=% (exp 140)', row->>'required'; fails:=fails+1; END IF;
  IF (row->>'in_stock')::numeric  <> 20  THEN RAISE WARNING 'reorder in_stock=% (exp 20)', row->>'in_stock'; fails:=fails+1; END IF;
  IF (row->>'order_qty')::numeric <> 40  THEN RAISE WARNING 'reorder order_qty=% (exp 40)', row->>'order_qty'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'MATERIAL-PLAN FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'MATERIAL-PLAN PASS: take-off surfaces mix-derived materials; per-building variance + planned_total; per-batch procurement (2×70=140); AC-9 flags mix overrun; reorder take-off sourced.';
END $$;
ROLLBACK;
SELECT 'Material plan (unified take-off): PASS' AS result;
