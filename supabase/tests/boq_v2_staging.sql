-- ═══════════════════════════════════════════════════════════════════════════
-- Phase 1 · BOQ staging v2 (BOQ_TRUE_COST_DESIGN §3.1/§8): rows carry the
-- document grammar; only 'item' rows auto-map; unknown units are flagged
-- server-side; priced_total / unpriced_count computed; suggestions validated;
-- v1-shaped rows still stage (legacy compatibility); confirm works on v2 rows.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/boq_v2_staging.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';  -- "Cement (50kg)"
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  typ uuid; typ2 uuid; stg uuid; stg_foreign uuid; imp uuid; row_id uuid;
  n int; q numeric; fails int := 0; t text; b boolean; u uuid;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  typ  := fn_create_building_type(org_a, 'V2 Type', 'terrace');
  stg  := fn_add_type_stage(typ, 'Substructure', 1);
  typ2 := fn_create_building_type(org_a, 'V2 Other Type', 'terrace');
  stg_foreign := fn_add_type_stage(typ2, 'Foreign Stage', 1);

  -- Teach the alias memory a name, so auto-map has something to find.
  INSERT INTO material_aliases (org_id, material_id, alias_text)
  VALUES (org_a, mat_a, 'Portland cement supply');

  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, jsonb_build_array(
    -- priced item, valid stage suggestion, mix + section + ref
    jsonb_build_object('raw_text','Portland cement supply','parsed_qty','2','parsed_unit','bag',
      'parsed_rate','9000','amount','18000','row_kind','item','boq_ref','A',
      'section_path', jsonb_build_array('ELEMENT 1','GENERALLY'),
      'suggested_stage_id', stg, 'suggested_kind','material_supply',
      'mix_ratio','', 'material_guess','Cement', 'flags', jsonb_build_array()),
    -- NOTE row with alias text — must NOT auto-map
    jsonb_build_object('raw_text','Portland cement supply','row_kind','note'),
    -- summary check row with an amount
    jsonb_build_object('raw_text','SUBSTRUCTURE TO SUMMARY','row_kind','summary','amount','18000'),
    -- unknown unit, no client flag → server backstop must flag it
    jsonb_build_object('raw_text','Mystery thing','parsed_qty','5','parsed_unit','weirdunit',
      'parsed_rate','100','row_kind','item'),
    -- measured but UNPRICED (no rate, no is_priced sent → derived false)
    jsonb_build_object('raw_text','Wall tiles supply and fix','parsed_qty','50','parsed_unit','Sq,m',
      'row_kind','item'),
    -- foreign-type stage suggestion → must be nulled
    jsonb_build_object('raw_text','Sneaky stage','parsed_qty','1','parsed_unit','item',
      'parsed_rate','10','row_kind','item','suggested_stage_id', stg_foreign)
  ),
  jsonb_build_object('grand', 18000),
  jsonb_build_object('extracted_total', 18000, 'stated_total', 18000, 'variance_pct', 0));

  -- Auto-map: the ITEM with alias text mapped; the NOTE with the same text not.
  SELECT mapped_material_id INTO u FROM boq_import_rows
   WHERE import_id = imp AND row_kind = 'item' AND raw_text = 'Portland cement supply';
  IF u IS DISTINCT FROM mat_a THEN RAISE WARNING 'item not auto-mapped'; fails:=fails+1; END IF;
  SELECT mapped_material_id INTO u FROM boq_import_rows
   WHERE import_id = imp AND row_kind = 'note';
  IF u IS NOT NULL THEN RAISE WARNING 'NOTE row was auto-mapped'; fails:=fails+1; END IF;

  -- Unit dictionary + server backstop flag.
  SELECT unit_normalized INTO t FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Wall tiles supply and fix';
  IF t <> 'm2' THEN RAISE WARNING '"Sq,m" not normalized to m2 (got %)', t; fails:=fails+1; END IF;
  SELECT (flags ? 'unknown_unit') INTO b FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Mystery thing';
  IF NOT b THEN RAISE WARNING 'unknown unit not flagged server-side'; fails:=fails+1; END IF;

  -- is_priced derivation + totals on the import header.
  SELECT is_priced INTO b FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Wall tiles supply and fix';
  IF b THEN RAISE WARNING 'rate-less row marked priced'; fails:=fails+1; END IF;
  SELECT priced_total, unpriced_count INTO q, n FROM boq_imports WHERE id = imp;
  IF q <> 18000 + 500 + 10 THEN RAISE WARNING 'priced_total=% (expected 18510)', q; fails:=fails+1; END IF;
  IF n <> 1 THEN RAISE WARNING 'unpriced_count=% (expected 1)', n; fails:=fails+1; END IF;

  -- Stage suggestion validation: valid kept, foreign nulled.
  SELECT suggested_stage_id INTO u FROM boq_import_rows
   WHERE import_id = imp AND raw_text = 'Portland cement supply' AND row_kind = 'item';
  IF u IS DISTINCT FROM stg THEN RAISE WARNING 'valid stage suggestion lost'; fails:=fails+1; END IF;
  SELECT suggested_stage_id INTO u FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Sneaky stage';
  IF u IS NOT NULL THEN RAISE WARNING 'foreign-type stage suggestion kept'; fails:=fails+1; END IF;

  -- Section path + reconciliation stored.
  SELECT section_path[1] INTO t FROM boq_import_rows
   WHERE import_id = imp AND raw_text = 'Portland cement supply' AND row_kind = 'item';
  IF t <> 'ELEMENT 1' THEN RAISE WARNING 'section_path lost (got %)', t; fails:=fails+1; END IF;
  SELECT (reconciliation->>'variance_pct')::numeric INTO q FROM boq_imports WHERE id = imp;
  IF q <> 0 THEN RAISE WARNING 'reconciliation not stored'; fails:=fails+1; END IF;

  -- Legacy v1-shaped rows (no row_kind) still stage as items.
  PERFORM fn_stage_boq_rows_v2(imp, '[{"raw_text":"Legacy row","parsed_qty":"3","parsed_unit":"bag"}]');
  SELECT row_kind::text INTO t FROM boq_import_rows WHERE import_id = imp AND raw_text = 'Legacy row';
  IF t <> 'item' THEN RAISE WARNING 'v1 row did not default to item'; fails:=fails+1; END IF;

  -- Confirm still works over v2-staged rows (through the Phase-0-fixed function).
  SELECT id INTO row_id FROM boq_import_rows
   WHERE import_id = imp AND raw_text = 'Portland cement supply' AND row_kind = 'item';
  PERFORM fn_confirm_boq_import(imp, jsonb_build_array(
    jsonb_build_object('row_id', row_id, 'material_id', mat_a, 'quantity', 2, 'unit', 'bag', 'stage_id', stg)));
  SELECT quantity INTO q FROM type_boq_items WHERE building_type_id = typ AND stage_id = stg;
  IF q <> 2 THEN RAISE WARNING 'confirm over v2 rows failed (qty=%)', q; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'BOQ-V2 STAGING FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'BOQ-V2 staging PASS: grammar staged; item-only auto-map; unit backstop; priced/unpriced totals; suggestion authz; legacy rows; confirm.';
END $$;
ROLLBACK;
SELECT 'BOQ v2 staging: PASS' AS result;
