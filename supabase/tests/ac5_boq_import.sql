-- ═══════════════════════════════════════════════════════════════════════════
-- M1 · F — AC-5: "An Excel and a PDF BOQ both import into a building type, with
-- unfamiliar items mapped once and remembered." Rows are proposals; a human
-- confirms; the confirm is idempotent. Runs in BEGIN/ROLLBACK.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/ac5_boq_import.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';  -- catalogue "Cement (50kg)"
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  typ uuid; stg uuid; imp1 uuid; imp2 uuid; imp3 uuid; row1 uuid; row2 uuid;
  m uuid; q numeric; n int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  typ := fn_create_building_type(org_a, 'AC5 Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Foundation', 1);

  -- ── Excel import #1: an UNFAMILIAR item name ("Portland cement bags") ──
  imp1 := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows(imp1,
    '[{"raw_text":"Portland cement bags","parsed_qty":"320","parsed_unit":"bag"}]');
  SELECT id INTO row1 FROM boq_import_rows WHERE import_id = imp1 LIMIT 1;

  -- Unfamiliar → not auto-mapped (no alias, no catalogue-name match).
  SELECT mapped_material_id INTO m FROM boq_import_rows WHERE id = row1;
  IF m IS NOT NULL THEN RAISE WARNING 'row was auto-mapped but should be unfamiliar'; fails:=fails+1; END IF;

  -- Human maps it once → confirm populates the recipe AND remembers the alias.
  PERFORM fn_confirm_boq_import(imp1, jsonb_build_array(
    jsonb_build_object('row_id', row1, 'material_id', mat_a, 'quantity', 320, 'unit', 'bag', 'stage_id', stg)));

  SELECT count(*) INTO n FROM type_boq_items WHERE building_type_id = typ;
  IF n <> 1 THEN RAISE WARNING 'type not populated (rows=%)', n; fails:=fails+1; END IF;
  SELECT quantity INTO q FROM type_boq_items WHERE building_type_id = typ;
  IF q <> 320 THEN RAISE WARNING 'recipe qty=% (expected 320)', q; fails:=fails+1; END IF;
  SELECT material_id INTO m FROM material_aliases
    WHERE org_id = org_a AND lower(alias_text) = 'portland cement bags';
  IF m <> mat_a THEN RAISE WARNING 'alias not remembered'; fails:=fails+1; END IF;

  -- ── Excel import #2: SAME item text → auto-mapped from memory ──
  imp2 := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows(imp2,
    '[{"raw_text":"Portland cement bags","parsed_qty":"300","parsed_unit":"bag"}]');
  SELECT id, mapped_material_id INTO row2, m FROM boq_import_rows WHERE import_id = imp2 LIMIT 1;
  IF m <> mat_a THEN RAISE WARNING 'second import not auto-mapped from alias (got %)', m; fails:=fails+1; END IF;

  -- Confirm import #2 updates the quantity (upsert, still one recipe row).
  PERFORM fn_confirm_boq_import(imp2, jsonb_build_array(
    jsonb_build_object('row_id', row2, 'material_id', mat_a, 'quantity', 300, 'unit', 'bag', 'stage_id', stg)));
  SELECT count(*), max(quantity) INTO n, q FROM type_boq_items WHERE building_type_id = typ;
  IF n <> 1 OR q <> 300 THEN RAISE WARNING 'upsert wrong: rows=% qty=%', n, q; fails:=fails+1; END IF;

  -- Idempotency: re-confirm #2 → no duplicate recipe row, no duplicate alias.
  PERFORM fn_confirm_boq_import(imp2, jsonb_build_array(
    jsonb_build_object('row_id', row2, 'material_id', mat_a, 'quantity', 300, 'unit', 'bag', 'stage_id', stg)));
  SELECT count(*) INTO n FROM type_boq_items WHERE building_type_id = typ;
  IF n <> 1 THEN RAISE WARNING 'idempotency: recipe duplicated (rows=%)', n; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM material_aliases WHERE org_id = org_a AND lower(alias_text) = 'portland cement bags';
  IF n <> 1 THEN RAISE WARNING 'idempotency: alias duplicated (rows=%)', n; fails:=fails+1; END IF;

  -- ── PDF lane: rows arrive as PROPOSALS with confidence (Rule 3) ──
  imp3 := fn_create_boq_import(org_a, typ, 'pdf');
  PERFORM fn_stage_boq_rows(imp3,
    '[{"raw_text":"Reinforcement Y12","parsed_qty":"1.8","parsed_unit":"ton","confidence":"0.88"}]');
  IF (SELECT confidence FROM boq_import_rows WHERE import_id = imp3) <> 0.88 THEN
    RAISE WARNING 'pdf proposal did not carry confidence'; fails:=fails+1; END IF;
  IF (SELECT status FROM boq_import_rows WHERE import_id = imp3) <> 'proposed' THEN
    RAISE WARNING 'pdf row not a proposal'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'AC-5 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-5 PASS: Excel+PDF import into a type; unfamiliar item mapped once then auto-mapped; idempotent.';
END $$;
ROLLBACK;
SELECT 'AC-5 BOQ import + mapping memory: PASS' AS result;
