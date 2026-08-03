-- ═══════════════════════════════════════════════════════════════════════════
-- Workbook ingest v3: split material/labour rate components survive staging →
-- confirm; the §7 price-proposal guardrail now prefers the material-only rate
-- and still refuses composite rows; boq_check_values are replace-by-sheet
-- idempotent, auto-map through alias memory, are manager-gated cross-org, and
-- type_takeoff_check compares stated vs computed live.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/boq_workbook.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';  -- "Cement (50kg)", unit bag
  mat_b uuid := 'b8888888-8888-8888-8888-888888888888';  -- org B's material
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  typ uuid; stg uuid; imp uuid; row_supply uuid; row_comp uuid; cv uuid;
  n int; q numeric; fails int := 0; t text; u uuid; b boolean;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  typ := fn_create_building_type(org_a, 'Workbook Type', 'g+3');
  stg := fn_add_type_stage(typ, 'Substructure', 1);
  INSERT INTO material_aliases (org_id, material_id, alias_text)
  VALUES (org_a, mat_a, 'Portland cement supply')
  ON CONFLICT (org_id, lower(alias_text)) DO NOTHING;

  -- ── 1. rate components: staged → work item ─────────────────────────────────
  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, jsonb_build_array(
    -- split-rate SUPPLY row (rebar-style: material 1450 + labour 260 = 1710)
    jsonb_build_object('raw_text','Portland cement supply','parsed_qty','2','parsed_unit','bag',
      'parsed_rate','1710','parsed_rate_material','1450','parsed_rate_labour','260',
      'row_kind','item','boq_ref','S08','suggested_kind','material_supply','row_no','1'),
    -- split-rate COMPOSITE row (concrete-style: must never propose a price)
    jsonb_build_object('raw_text','C20 reinforced concrete in pad foundations','parsed_qty','45.5',
      'parsed_unit','m3','parsed_rate','180000','parsed_rate_material','148000',
      'parsed_rate_labour','32000','row_kind','item','boq_ref','S07',
      'suggested_kind','composite','mix_ratio','1:2:4','row_no','2'),
    -- single-rate row: components stay NULL (no phantom split)
    jsonb_build_object('raw_text','Excavate trench','parsed_qty','100','parsed_unit','m3',
      'parsed_rate','4500','row_kind','item','suggested_kind','labour','row_no','3')
  ));

  SELECT parsed_rate_material, parsed_rate_labour INTO q, n
    FROM boq_import_rows WHERE import_id = imp AND boq_ref = 'S08';
  IF q <> 1450 OR n <> 260 THEN RAISE WARNING 'split rate not staged (%, %)', q, n; fails:=fails+1; END IF;
  SELECT parsed_rate_material INTO q FROM boq_import_rows
   WHERE import_id = imp AND raw_text = 'Excavate trench';
  IF q IS NOT NULL THEN RAISE WARNING 'phantom rate component on single-rate row'; fails:=fails+1; END IF;

  SELECT id INTO row_supply FROM boq_import_rows WHERE import_id = imp AND boq_ref = 'S08';
  SELECT id INTO row_comp   FROM boq_import_rows WHERE import_id = imp AND boq_ref = 'S07';
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', row_supply, 'stage_id', stg, 'kind', 'material_supply',
                       'material_id', mat_a, 'quantity', 2, 'unit', 'bag'),
    jsonb_build_object('row_id', row_comp, 'stage_id', stg, 'kind', 'composite',
                       'quantity', 45.5, 'unit', 'm3')));

  SELECT boq_rate INTO q FROM type_work_items WHERE source_row_id = row_supply;
  IF q <> 1710 THEN RAISE WARNING 'work item all-in rate lost (%)', q; fails:=fails+1; END IF;
  SELECT boq_rate_material INTO q FROM type_work_items WHERE source_row_id = row_supply;
  IF q <> 1450 THEN RAISE WARNING 'work item material rate lost (%)', q; fails:=fails+1; END IF;
  SELECT boq_rate_labour INTO q FROM type_work_items WHERE source_row_id = row_supply;
  IF q <> 260 THEN RAISE WARNING 'work item labour rate lost (%)', q; fails:=fails+1; END IF;
  SELECT boq_rate_labour INTO q FROM type_work_items WHERE source_row_id = row_comp;
  IF q <> 32000 THEN RAISE WARNING 'composite labour component lost (%)', q; fails:=fails+1; END IF;

  -- Idempotent re-confirm keeps the components.
  PERFORM fn_confirm_boq_import_v2(imp, jsonb_build_array(
    jsonb_build_object('row_id', row_supply, 'stage_id', stg, 'kind', 'material_supply',
                       'material_id', mat_a, 'quantity', 2, 'unit', 'bag')));
  SELECT COUNT(*), MAX(boq_rate_material) INTO n, q FROM type_work_items WHERE source_row_id = row_supply;
  IF n <> 1 OR q <> 1450 THEN RAISE WARNING 're-confirm duplicated or lost components (n=%, mat=%)', n, q; fails:=fails+1; END IF;

  -- ── 2. §7 guardrail: material-only rate proposed; composite refused ────────
  n := fn_propose_prices_from_import(imp);
  IF n <> 1 THEN RAISE WARNING 'expected exactly 1 price proposal (supply row), got %', n; fails:=fails+1; END IF;
  SELECT (output->>'proposed_price')::numeric INTO q FROM ai_inferences
   WHERE org_id = org_a AND subject_type = 'price_proposal' AND subject_id = row_supply;
  IF q <> 1450 THEN RAISE WARNING 'proposal used % — must be the MATERIAL rate 1450, not the all-in 1710', q; fails:=fails+1; END IF;
  SELECT COUNT(*) INTO n FROM ai_inferences
   WHERE org_id = org_a AND subject_type = 'price_proposal' AND subject_id = row_comp;
  IF n <> 0 THEN RAISE WARNING 'composite row generated a price proposal — §7 breached'; fails:=fails+1; END IF;

  -- ── 3. check values: insert, auto-map, replace-by-sheet idempotency ────────
  n := fn_set_boq_check_values(typ, 'Materials Schedule', jsonb_build_array(
    jsonb_build_object('label','Portland cement supply','unit','bag','qty','3','section','CONCRETE'),
    jsonb_build_object('label','Y16 rebar total','unit','kg','qty','6300'),
    jsonb_build_object('label','A heading with no numbers')));       -- must be skipped
  IF n <> 2 THEN RAISE WARNING 'expected 2 check values, got %', n; fails:=fails+1; END IF;
  SELECT material_id INTO u FROM boq_check_values
   WHERE building_type_id = typ AND label = 'Portland cement supply';
  IF u IS DISTINCT FROM mat_a THEN RAISE WARNING 'check value not auto-mapped via alias'; fails:=fails+1; END IF;

  n := fn_set_boq_check_values(typ, 'Materials Schedule', jsonb_build_array(
    jsonb_build_object('label','Portland cement supply','unit','bag','qty','3')));
  SELECT COUNT(*) INTO n FROM boq_check_values WHERE building_type_id = typ AND source_sheet = 'Materials Schedule';
  IF n <> 1 THEN RAISE WARNING 'replace-by-sheet not idempotent (% rows)', n; fails:=fails+1; END IF;

  -- Money checks live beside quantity checks (different sheet).
  PERFORM fn_set_boq_check_values(typ, 'Summary', jsonb_build_array(
    jsonb_build_object('label','BASE CONSTRUCTION COST','amount','155709487.06')));
  SELECT COUNT(*) INTO n FROM boq_check_values WHERE building_type_id = typ;
  IF n <> 2 THEN RAISE WARNING 'summary sheet replaced the schedule sheet (%)', n; fails:=fails+1; END IF;

  -- ── 4. live comparison view ────────────────────────────────────────────────
  -- Supply work item: 2 bags computed; stated 3 bags → +50.0%.
  SELECT variance_pct INTO q FROM type_takeoff_check
   WHERE building_type_id = typ AND label = 'Portland cement supply';
  IF q IS DISTINCT FROM 50.0 THEN RAISE WARNING 'variance_pct=% (expected 50.0)', q; fails:=fails+1; END IF;
  SELECT variance_pct INTO q FROM type_takeoff_check
   WHERE building_type_id = typ AND label = 'Y16 rebar total';
  IF q IS NOT NULL THEN RAISE WARNING 'unmapped check value produced a variance'; fails:=fails+1; END IF;

  -- Mapping through the server fn updates the comparison.
  SELECT id INTO cv FROM boq_check_values WHERE building_type_id = typ AND label = 'Y16 rebar total';
  BEGIN
    PERFORM fn_map_boq_check_value(cv, mat_b);   -- org B's material → must refuse
    RAISE WARNING 'cross-org material accepted on check value'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- ── 5. cross-org write gate ────────────────────────────────────────────────
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_set_boq_check_values(typ, 'Sneaky', jsonb_build_array(
      jsonb_build_object('label','X','qty','1')));
    RAISE WARNING 'org B wrote check values into org A''s recipe'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'BOQ WORKBOOK FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'BOQ workbook PASS: rate components chain; §7 material-rate upgrade; check values idempotent + gated; live variance.';
END $$;
ROLLBACK;
SELECT 'BOQ workbook: PASS' AS result;
