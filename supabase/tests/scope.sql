-- ═══════════════════════════════════════════════════════════════════════════
-- Contract scope: bill sets the default (priced=in, unpriced=out); budget photo
-- counts contract only; EV/finish exclude by-others lines; a VARIATION pulls an
-- excluded line into ONE building and extends its budget by the est at addition.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  mat_cement uuid := 'a7777777-7777-7777-7777-777777777777';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  typ uuid; stg uuid; imp uuid; r_in uuid; r_out uuid; wi_out uuid;
  ph uuid; ba uuid; bld uuid; n int; q numeric; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Scope Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Finishes', 1);
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, '[
    {"raw_text":"Cement supply","parsed_qty":"10","parsed_unit":"bag","parsed_rate":"9500","row_kind":"item","suggested_kind":"material_supply"},
    {"raw_text":"Wall tiles supply and fix","parsed_qty":"50","parsed_unit":"m2","row_kind":"item","suggested_kind":"material_supply"}]');
  SELECT id INTO r_in  FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Cement%';
  SELECT id INTO r_out FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Wall tiles%';
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', r_in,  'stage_id', stg, 'kind', 'material_supply', 'material_id', mat_cement),
    jsonb_build_object('row_id', r_out, 'stage_id', stg, 'kind', 'material_supply')));

  -- Bill-derived scope: priced line in, unpriced line out.
  SELECT count(*) INTO n FROM type_work_items WHERE building_type_id = typ AND in_scope;
  IF n <> 1 THEN RAISE WARNING 'in-scope count=% (expected 1)', n; fails:=fails+1; END IF;
  SELECT id INTO wi_out FROM type_work_items WHERE building_type_id = typ AND NOT in_scope;
  IF wi_out IS NULL THEN RAISE WARNING 'unpriced line not defaulted OUT of scope'; fails:=fails+1; END IF;

  ph := fn_create_phase(proj, 'Scope Phase', 1);
  ba := fn_create_batch(proj, 'Scope Batch', ph, 1);
  PERFORM fn_create_buildings(typ, 1, proj, ba, ph, 'SC');
  SELECT id INTO bld FROM buildings WHERE project_id = proj AND building_type_id = typ LIMIT 1;

  -- Budget photo = contract only: 10 × 9500 = 95,000 (tiles excluded).
  PERFORM fn_snapshot_building_budget(bld);
  SELECT budget INTO q FROM building_money WHERE building_id = bld;
  IF q <> 95000 THEN RAISE WARNING 'budget=% (expected 95000, contract only)', q; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM building_work_ev WHERE building_id = bld;
  IF n <> 1 THEN RAISE WARNING 'EV rows=% (expected 1, excluded line hidden)', n; fails:=fails+1; END IF;

  -- Variation: price the tiles via an agreed rate (Option B path), then pull
  -- them into THIS building.
  PERFORM fn_update_work_item(wi_out, 'labour',
    fn_upsert_assembly(org_a, 'Rate: wall tiles', 'm2', 'custom', NULL, 1, 9500, NULL, NULL, '[]'::jsonb),
    NULL, false, false, NULL);
  PERFORM fn_add_building_variation(bld, wi_out, 'client wants tiles');
  SELECT count(*) INTO n FROM building_work_ev WHERE building_id = bld;
  IF n <> 2 THEN RAISE WARNING 'variation line not in EV (%)', n; fails:=fails+1; END IF;
  SELECT budget INTO q FROM building_money WHERE building_id = bld;
  IF q <> 95000 + 50 * 9500 THEN RAISE WARNING 'budget after variation=% (expected 570000)', q; fails:=fails+1; END IF;
  -- Idempotent re-add.
  PERFORM fn_add_building_variation(bld, wi_out, 'again');
  SELECT count(*) INTO n FROM building_variations WHERE building_id = bld;
  IF n <> 1 THEN RAISE WARNING 'variation duplicated (%)', n; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'SCOPE FAILED: %', fails; END IF;
  RAISE NOTICE 'SCOPE PASS: bill-derived defaults; contract-only photo+EV; variation extends one building, idempotent.';
END $$;
ROLLBACK;
SELECT 'Contract scope: PASS' AS result;
