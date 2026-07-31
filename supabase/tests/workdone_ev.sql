-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 3 · Work-done + earned value: dated labour rates override the static
-- assembly rate (live re-cost); fn_log_work_done is idempotent and guarded;
-- building_work_ev = latest cumulative qty_done × live unit cost; authz.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  mat_cement uuid := 'a7777777-7777-7777-7777-777777777777';  -- bag @ 9500 (seed)
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  asm uuid; typ uuid; stg uuid; imp uuid; row1 uuid; wi uuid;
  imp2 uuid; row2 uuid; wi2 uuid; src text;
  ph uuid; ba uuid; bld uuid; n int; q numeric; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Assembly: 7 bags cement (waste 1) + static ₦3,000 labour per m³ → 69,500/m³.
  asm := fn_upsert_assembly(org_a, 'EV Concrete', 'm3', 'concrete', '1:2:4', 1.54, 3000, NULL, NULL,
    jsonb_build_array(jsonb_build_object('material_id', mat_cement, 'qty_per_unit', 7, 'unit', 'bag', 'waste_factor', 1)));

  typ := fn_create_building_type(org_a, 'EV Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Frame', 1);
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, '[{"raw_text":"Concrete grade 20 columns","parsed_qty":"10","parsed_unit":"m3","parsed_rate":"195000","row_kind":"item","suggested_kind":"composite"}]');
  SELECT id INTO row1 FROM boq_import_rows WHERE import_id = imp;
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', row1, 'stage_id', stg, 'kind', 'composite', 'assembly_id', asm)));
  SELECT id INTO wi FROM type_work_items WHERE building_type_id = typ;

  SELECT fn_work_item_unit_cost(wi) INTO q;
  IF q <> 69500 THEN RAISE WARNING 'static unit cost=% (expected 69500)', q; fails:=fails+1; END IF;

  -- Dated labour rate overrides the static assembly rate → 7×9500 + 5000 = 71,500.
  PERFORM fn_set_labour_rate(org_a, asm, NULL, 'm3', 5000);
  SELECT fn_work_item_unit_cost(wi) INTO q;
  IF q <> 71500 THEN RAISE WARNING 'dated labour rate not applied (unit cost=%)', q; fails:=fails+1; END IF;

  -- A building of this type.
  ph  := fn_create_phase(proj, 'EV Phase', 1);
  ba  := fn_create_batch(proj, 'EV Batch', ph, 1);
  PERFORM fn_create_buildings(typ, 1, proj, ba, ph, 'EV');
  SELECT id INTO bld FROM buildings WHERE project_id = proj AND building_type_id = typ LIMIT 1;

  -- Log 4 of 10 m³ done; EV = 4 × 71,500 = 286,000; planned = 715,000.
  PERFORM fn_log_work_done(bld, wi, 4, 'idem-ev-1');
  SELECT earned_value, planned_value INTO q, n FROM building_work_ev
   WHERE building_id = bld AND work_item_id = wi;
  IF q <> 286000 THEN RAISE WARNING 'earned_value=% (expected 286000)', q; fails:=fails+1; END IF;
  IF n <> 715000 THEN RAISE WARNING 'planned_value=% (expected 715000)', n; fails:=fails+1; END IF;

  -- Idempotent retry: same key → still ONE actuals row.
  PERFORM fn_log_work_done(bld, wi, 4, 'idem-ev-1');
  SELECT count(*) INTO n FROM building_work_actuals WHERE building_id = bld;
  IF n <> 1 THEN RAISE WARNING 'retry duplicated work-done (%)', n; fails:=fails+1; END IF;

  -- Later cumulative entry supersedes: qty_done 6 → EV 429,000.
  PERFORM fn_log_work_done(bld, wi, 6, 'idem-ev-2', CURRENT_DATE + 1);
  SELECT earned_value INTO q FROM building_work_ev WHERE building_id = bld AND work_item_id = wi;
  IF q <> 429000 THEN RAISE WARNING 'latest entry not used (EV=%)', q; fails:=fails+1; END IF;

  -- ── Blended estimate (founder pilot fix 2026-07-31): a QS-rate-only line (no
  -- build-up attached) still carries planned/earned value from its BOQ rate,
  -- labelled boq_rate — matching the budget photo and the recipe, not dropped. ──
  imp2 := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp2, '[{"raw_text":"Soil pipes (needs a mix)","parsed_qty":"8","parsed_unit":"m3","parsed_rate":"50000","row_kind":"item","suggested_kind":"composite"}]');
  SELECT id INTO row2 FROM boq_import_rows WHERE import_id = imp2;
  PERFORM fn_confirm_boq_import_v2(imp2, jsonb_build_array(
    jsonb_build_object('row_id', row2, 'stage_id', stg, 'kind', 'composite')));  -- no assembly → no build-up
  SELECT id INTO wi2 FROM type_work_items WHERE building_type_id = typ AND id <> wi;
  PERFORM fn_update_work_item(wi2, NULL, NULL, NULL, false, false, true);        -- force in-scope

  SELECT unit_cost_live, planned_value, est_source INTO q, n, src
    FROM building_work_ev WHERE building_id = bld AND work_item_id = wi2;
  IF q   <> 50000    THEN RAISE WARNING 'fallback unit_cost_live=% (expected 50000 QS rate)', q; fails:=fails+1; END IF;
  IF n   <> 400000   THEN RAISE WARNING 'fallback planned_value=% (expected 400000)', n; fails:=fails+1; END IF;
  IF src <> 'boq_rate' THEN RAISE WARNING 'fallback est_source=% (expected boq_rate)', src; fails:=fails+1; END IF;

  -- Earned value blends too: 2 of 8 done → 2 × 50,000 = 100,000.
  PERFORM fn_log_work_done(bld, wi2, 2, 'idem-ev-fb');
  SELECT earned_value INTO q FROM building_work_ev WHERE building_id = bld AND work_item_id = wi2;
  IF q <> 100000 THEN RAISE WARNING 'fallback earned_value=% (expected 100000)', q; fails:=fails+1; END IF;

  -- Guard: >150% of designed quantity rejected.
  BEGIN
    PERFORM fn_log_work_done(bld, wi, 16, 'idem-ev-3');
    RAISE WARNING 'over-quantity work-done accepted'; fails:=fails+1;
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  -- Authz: org B cannot log against org A's building.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_log_work_done(bld, wi, 1, 'idem-ev-b');
    RAISE WARNING 'cross-org work-done accepted'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'WORKDONE-EV FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'WORKDONE-EV PASS: dated labour rate live; EV latest-cumulative × live cost; QS-rate fallback blends (planned/earned labelled boq_rate); idempotent; quantity guard; authz.';
END $$;
ROLLBACK;
SELECT 'Work-done + earned value: PASS' AS result;
