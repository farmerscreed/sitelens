-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 2 · TRUE-COST core: work items from a v2 import; assembly take-off with
-- waste + conversions; live cost re-prices on a price change (AC-7 tie);
-- material_supply lines feed the classic recipe; idempotent re-confirm;
-- §7 guardrail — composite/labour BOQ rates can NEVER become price proposals;
-- cross-org confirm blocked.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/truecost.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_cement uuid := 'a7777777-7777-7777-7777-777777777777';  -- bag @ 9500 (seed)
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  mat_sand uuid; asm uuid; typ uuid; stg uuid; imp uuid;
  row_comp uuid; row_supply uuid; row_lab uuid; row_unpriced uuid;
  n int; q numeric; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Materials + prices + m3→ton conversion for sand.
  mat_sand := fn_upsert_material(org_a, 'Sharp sand', 'ton');
  PERFORM fn_set_material_price(org_a, mat_sand, 10000);
  PERFORM fn_set_material_conversion(org_a, mat_sand, 'm3', 'ton', 1.6);

  -- Assembly: grade 20 concrete — 7 bags cement (no waste for exact math) +
  -- 0.5 m³ sand per m³ (converts to ton) + ₦3,000 placing labour per m³.
  asm := fn_upsert_assembly(org_a, 'Concrete grade 20 (1:2:4)', 'm3', 'concrete', '1:2:4',
    1.54, 3000, NULL, NULL, jsonb_build_array(
      jsonb_build_object('material_id', mat_cement, 'qty_per_unit', 7,   'unit', 'bag', 'waste_factor', 1),
      jsonb_build_object('material_id', mat_sand,   'qty_per_unit', 0.5, 'unit', 'm3',  'waste_factor', 1)));

  typ := fn_create_building_type(org_a, 'TrueCost Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Substructure', 1);

  -- Stage a v2 import: composite + supply + labour + unpriced (the §2 mix).
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, jsonb_build_array(
    jsonb_build_object('raw_text','Concrete grade 20 (1:2:4) in foundation','parsed_qty','10',
      'parsed_unit','Cu.m','parsed_rate','195000','amount','1950000','row_kind','item',
      'suggested_kind','composite','mix_ratio','1:2:4'),
    jsonb_build_object('raw_text','Sharp sand deposited and compacted','parsed_qty','5',
      'parsed_unit','Cu.m','parsed_rate','11100','row_kind','item','suggested_kind','material_supply'),
    jsonb_build_object('raw_text','Clearing of site of bushes','parsed_qty','728',
      'parsed_unit','m2','parsed_rate','300','row_kind','item','suggested_kind','labour'),
    jsonb_build_object('raw_text','Wall tiles supply and fix','parsed_qty','50',
      'parsed_unit','m2','row_kind','item','suggested_kind','material_supply')));
  SELECT id INTO row_comp    FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Concrete%';
  SELECT id INTO row_supply  FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Sharp sand%';
  SELECT id INTO row_lab     FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Clearing%';
  SELECT id INTO row_unpriced FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Wall tiles%';

  -- Confirm v2 → work items (sand auto-mapped? no alias — map explicitly).
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', row_comp, 'stage_id', stg, 'kind', 'composite', 'assembly_id', asm),
    jsonb_build_object('row_id', row_supply, 'stage_id', stg, 'kind', 'material_supply', 'material_id', mat_sand),
    jsonb_build_object('row_id', row_lab, 'stage_id', stg, 'kind', 'labour'),
    jsonb_build_object('row_id', row_unpriced, 'stage_id', stg, 'kind', 'material_supply')));

  SELECT count(*) INTO n FROM type_work_items WHERE building_type_id = typ;
  IF n <> 4 THEN RAISE WARNING 'work items=% (expected 4)', n; fails:=fails+1; END IF;

  -- Live cost of the composite: 10 × (7×9500 + 0.5×1.6×10000 + 3000) = 775,000.
  SELECT cost_live INTO q FROM work_item_cost WHERE source_row_id = row_comp;
  IF q <> 775000 THEN RAISE WARNING 'composite cost_live=% (expected 775000)', q; fails:=fails+1; END IF;
  SELECT boq_amount INTO q FROM work_item_cost WHERE source_row_id = row_comp;
  IF q <> 1950000 THEN RAISE WARNING 'boq_amount=% (expected 1950000, reference only)', q; fails:=fails+1; END IF;

  -- Take-off: cement 10×7 = 70 bag; sand 10×0.5×1.6 + 5×1.6 = 8 + 8 = 16 ton.
  SELECT qty_required INTO q FROM type_material_takeoff
   WHERE building_type_id = typ AND material_id = mat_cement;
  IF q <> 70 THEN RAISE WARNING 'takeoff cement=% (expected 70)', q; fails:=fails+1; END IF;
  SELECT qty_required INTO q FROM type_material_takeoff
   WHERE building_type_id = typ AND material_id = mat_sand;
  IF q <> 16 THEN RAISE WARNING 'takeoff sand=% (expected 16 ton)', q; fails:=fails+1; END IF;

  -- material_supply line landed in the classic recipe too.
  SELECT quantity INTO q FROM type_boq_items
   WHERE building_type_id = typ AND stage_id = stg AND material_id = mat_sand;
  IF q <> 5 THEN RAISE WARNING 'recipe qty=% (expected 5)', q; fails:=fails+1; END IF;

  -- AC-7 tie: a price change re-costs the composite LIVE (no stored cost anywhere).
  PERFORM fn_set_material_price(org_a, mat_cement, 10000);
  SELECT cost_live INTO q FROM work_item_cost WHERE source_row_id = row_comp;
  IF q <> 810000 THEN RAISE WARNING 're-cost=% (expected 810000 after price change)', q; fails:=fails+1; END IF;

  -- Idempotency: re-confirm the same items → same 4 work items, same take-off.
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', row_comp, 'stage_id', stg, 'kind', 'composite', 'assembly_id', asm)));
  SELECT count(*) INTO n FROM type_work_items WHERE building_type_id = typ;
  IF n <> 4 THEN RAISE WARNING 're-confirm duplicated work items (%)', n; fails:=fails+1; END IF;
  SELECT qty_required INTO q FROM type_material_takeoff
   WHERE building_type_id = typ AND material_id = mat_cement;
  IF q <> 70 THEN RAISE WARNING 'takeoff after re-confirm=% (expected 70)', q; fails:=fails+1; END IF;

  -- §7 guardrail: ONLY the material_supply row with a rate proposes a price.
  -- (composite @195,000 and labour @300 are all-in rates — never price proposals;
  -- tiles have no rate.) Exactly ONE proposal, for sand @11,100.
  SELECT fn_propose_prices_from_import(imp) INTO n;
  IF n <> 1 THEN RAISE WARNING 'price proposals=% (expected exactly 1)', n; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM ai_inferences
   WHERE org_id = org_a AND subject_type = 'price_proposal'
     AND (output->>'material_id')::uuid = mat_sand AND (output->>'proposed_price')::numeric = 11100;
  IF n <> 1 THEN RAISE WARNING 'sand proposal missing/misshaped'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM ai_inferences
   WHERE org_id = org_a AND subject_type = 'price_proposal' AND (output->>'proposed_price')::numeric IN (195000, 300);
  IF n <> 0 THEN RAISE WARNING 'GUARDRAIL BREACH: composite/labour rate proposed as a price'; fails:=fails+1; END IF;
  -- And nothing wrote material_prices without a human: sand still has ONE price row.
  SELECT count(*) INTO n FROM material_prices WHERE org_id = org_a AND material_id = mat_sand;
  IF n <> 1 THEN RAISE WARNING 'material_prices written without human accept (%)', n; fails:=fails+1; END IF;

  -- Cross-org: org B's admin cannot confirm into org A's import.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
      jsonb_build_object('row_id', row_comp, 'kind', 'other')));
    RAISE WARNING 'cross-org confirm was allowed'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; -- expected
  END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'TRUE-COST FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'TRUE-COST PASS: work items; assembly take-off (waste+conversion); live re-cost on price change; recipe fed; idempotent; price guardrail holds; authz.';
END $$;
ROLLBACK;
SELECT 'True-cost core: PASS' AS result;
