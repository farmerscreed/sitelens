-- ═══════════════════════════════════════════════════════════════════════════
-- Planner costs from the TRUE-COST engine (pilot Area 5): a composite work item
-- (concrete → cement + labour) has NO type_boq_items row, so the old basis would
-- cost it ₦0; feasibility and max-delivery must use its est_cost (₦695,000/unit).
-- (The legacy type_boq_items/stage-cost path stays covered by ac8_feasibility.)
-- BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  cement uuid := 'a7777777-7777-7777-7777-777777777777';   -- bag @ 9500 (seed)
  asm uuid; typ uuid; stg uuid; imp uuid; r1 uuid; wi uuid;
  plan uuid; planM uuid; ln uuid; v numeric; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Mix: 7 bags cement (₦9,500) + ₦3,000 labour per m³ → ₦69,500/m³; 10 m³ = ₦695,000.
  asm := fn_upsert_assembly(org_a, 'PL Concrete', 'm3', 'concrete', '1:2:4', 1.54, 3000, NULL, NULL,
    jsonb_build_array(jsonb_build_object('material_id', cement, 'qty_per_unit', 7, 'unit', 'bag', 'waste_factor', 1)));
  typ := fn_create_building_type(org_a, 'PL Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Frame', 1);
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, '[{"raw_text":"Concrete columns","parsed_qty":"10","parsed_unit":"m3","parsed_rate":"195000","row_kind":"item","suggested_kind":"composite"}]');
  SELECT id INTO r1 FROM boq_import_rows WHERE import_id = imp;
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', r1, 'stage_id', stg, 'kind', 'composite', 'assembly_id', asm)));
  SELECT id INTO wi FROM type_work_items WHERE building_type_id = typ;
  PERFORM fn_update_work_item(wi, NULL, NULL, NULL, false, false, true);   -- ensure in-scope

  -- Composite has NO type_boq_items row (old basis → ₦0); feasibility = est_cost ₦695,000.
  plan := fn_create_plan(org_a, 'PL Plan', 'funding_required');
  PERFORM fn_set_plan_line(plan, typ, 1, stg, NULL);
  v := (fn_compute_feasibility(plan)->>'total_funding')::numeric;
  IF v <> 695000 THEN RAISE WARNING 'feasibility total=% (exp 695000 true-cost)', v; fails:=fails+1; END IF;

  -- Quantity is a multiplier → ×2 = ₦1,390,000.
  PERFORM fn_set_plan_line(plan, typ, 2, stg, NULL);
  v := (fn_compute_feasibility(plan)->>'total_funding')::numeric;
  IF v <> 1390000 THEN RAISE WARNING 'feasibility ×2=% (exp 1390000)', v; fails:=fails+1; END IF;

  -- Max-delivery: ₦3,000,000 / ₦695,000 = 4 units.
  planM := fn_create_plan(org_a, 'PL Max', 'max_delivery', NULL, 3000000, '[]'::jsonb);
  PERFORM fn_set_plan_line(planM, typ, 1, stg, NULL);
  v := (fn_max_delivery(planM)->>'mix_cost')::numeric;
  IF v <> 695000 THEN RAISE WARNING 'max-delivery mix_cost=% (exp 695000)', v; fails:=fails+1; END IF;
  v := (fn_max_delivery(planM)->>'multiplier')::numeric;
  IF v <> 4 THEN RAISE WARNING 'max-delivery multiplier=% (exp 4)', v; fails:=fails+1; END IF;

  -- Delete a plan line — it's removed; a cross-org caller cannot.
  SELECT id INTO ln FROM plan_lines WHERE plan_id = plan LIMIT 1;
  PERFORM fn_delete_plan_line(plan, ln);
  IF EXISTS (SELECT 1 FROM plan_lines WHERE id = ln) THEN RAISE WARNING 'plan line not deleted'; fails:=fails+1; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub','b2222222-2222-2222-2222-222222222222')::text, true);
  BEGIN PERFORM fn_delete_plan_line(planM, (SELECT id FROM plan_lines WHERE plan_id=planM LIMIT 1));
    RAISE WARNING 'cross-org deleted a plan line'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'PLANNER-TRUECOST FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'PLANNER-TRUECOST PASS: feasibility + max-delivery cost from est_cost (mixes+labour) not type_boq_items; plan-line delete + authz.';
END $$;
ROLLBACK;
SELECT 'Planner true-cost: PASS' AS result;
