-- ═══════════════════════════════════════════════════════════════════════════
-- Blended estimate: est_cost = live build-up else BOQ-rate fallback (labelled);
-- fn_update_work_item re-kinds/attaches and flips the source live; authz.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_cement uuid := 'a7777777-7777-7777-7777-777777777777';  -- bag @ 9500 (seed)
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  asm uuid; typ uuid; stg uuid; imp uuid; r1 uuid; wi uuid;
  q numeric; t text; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Est Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Frame', 1);
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, '[{"raw_text":"Pad bases","parsed_qty":"74","parsed_unit":"Cu.m","parsed_rate":"195000","row_kind":"item","suggested_kind":"other"}]');
  SELECT id INTO r1 FROM boq_import_rows WHERE import_id = imp;
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', r1, 'stage_id', stg, 'kind', 'other')));
  SELECT id INTO wi FROM type_work_items WHERE building_type_id = typ;

  -- No build-up yet → est falls back to the QS rate, labelled boq_rate.
  SELECT est_cost, est_source INTO q, t FROM work_item_cost WHERE id = wi;
  IF q <> 74 * 195000 OR t <> 'boq_rate' THEN
    RAISE WARNING 'fallback est wrong (%, %)', q, t; fails:=fails+1; END IF;

  -- Re-kind + attach an assembly → est flips to the live build-up.
  asm := fn_upsert_assembly(org_a, 'Est Concrete', 'm3', 'concrete', '1:2:4', 1.54, 3000, NULL, NULL,
    jsonb_build_array(jsonb_build_object('material_id', mat_cement, 'qty_per_unit', 7, 'unit', 'bag', 'waste_factor', 1)));
  PERFORM fn_update_work_item(wi, 'composite', asm, NULL);
  SELECT est_cost, est_source INTO q, t FROM work_item_cost WHERE id = wi;
  IF q <> 74 * (7 * 9500 + 3000) OR t <> 'build_up' THEN
    RAISE WARNING 'build-up est wrong (%, %)', q, t; fails:=fails+1; END IF;

  -- Authz: org B cannot edit org A's work item.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_update_work_item(wi, 'labour', NULL, NULL);
    RAISE WARNING 'cross-org work-item edit allowed'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'WORKITEM-EST FAILED: %', fails; END IF;
  RAISE NOTICE 'WORKITEM-EST PASS: boq_rate fallback labelled; re-kind+assembly flips to build_up live; authz.';
END $$;
ROLLBACK;
SELECT 'Blended estimate: PASS' AS result;
