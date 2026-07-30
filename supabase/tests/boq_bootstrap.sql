-- ═══════════════════════════════════════════════════════════════════════════
-- BOQ bootstrap: stages from elements (fuzzy-map existing, append missing,
-- never restructure); materials from the bill (+ seeded price for SUPPLY rows
-- only — §7 guardrail); rows auto-assigned/mapped; aliases remembered;
-- progress fn writes; idempotent-ish re-run creates no duplicates.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  typ uuid; stg_existing uuid; imp uuid; res jsonb;
  r_sand uuid; r_conc uuid; r_roof uuid; n int; q numeric; u uuid; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  typ := fn_create_building_type(org_a, 'Bootstrap Type', 'terrace');
  -- The user already designed ONE stage; fuzzy match must reuse it, not duplicate.
  stg_existing := fn_add_type_stage(typ, 'Substructure works', 1);

  imp := fn_create_boq_import(org_a, typ, 'xlsx');
  PERFORM fn_stage_boq_rows_v2(imp, jsonb_build_array(
    jsonb_build_object('raw_text','1630mm Sharp sand deposited, well rammed','parsed_qty','713',
      'parsed_unit','Cu.m','parsed_rate','11100','row_kind','item','row_no','10',
      'suggested_kind','material_supply','material_guess','Sharp sand',
      'section_path', jsonb_build_array('ELEMENT 1 — SUBSTRUCTURE (ALL PROVISIONAL)')),
    jsonb_build_object('raw_text','Concrete grade 20 in foundation','parsed_qty','32',
      'parsed_unit','Cu.m','parsed_rate','195000','row_kind','item','row_no','20',
      'suggested_kind','composite',
      'section_path', jsonb_build_array('ELEMENT 1 — SUBSTRUCTURE (ALL PROVISIONAL)')),
    jsonb_build_object('raw_text','Roofing Sheet','parsed_qty','336','parsed_unit','Sq.m',
      'parsed_rate','12500','row_kind','item','row_no','30',
      'suggested_kind','material_supply','material_guess','Roofing sheet 0.55mm',
      'section_path', jsonb_build_array('ELEMENT 4 - ROOF'))));
  SELECT id INTO r_sand FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE '1630mm%';
  SELECT id INTO r_conc FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Concrete%';
  SELECT id INTO r_roof FROM boq_import_rows WHERE import_id = imp AND raw_text LIKE 'Roofing%';

  -- ── stages ──
  res := fn_bootstrap_stages_from_import(imp);
  IF (res->>'created')::int <> 1 THEN
    RAISE WARNING 'stages created=% (expected 1: only ROOF — Substructure fuzzy-matched)', res->>'created'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM type_stages WHERE building_type_id = typ;
  IF n <> 2 THEN RAISE WARNING 'stage count=% (expected 2, no duplicate substructure)', n; fails:=fails+1; END IF;
  SELECT suggested_stage_id INTO u FROM boq_import_rows WHERE id = r_sand;
  IF u IS DISTINCT FROM stg_existing THEN RAISE WARNING 'sand row not fuzzy-mapped to existing stage'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM type_stages WHERE building_type_id = typ AND lower(name) = 'roof' AND sequence = 2;
  IF n <> 1 THEN RAISE WARNING 'ROOF stage not appended after user sequence'; fails:=fails+1; END IF;
  -- Re-run: no new stages.
  PERFORM fn_bootstrap_stages_from_import(imp);
  SELECT count(*) INTO n FROM type_stages WHERE building_type_id = typ;
  IF n <> 2 THEN RAISE WARNING 're-run duplicated stages (%)', n; fails:=fails+1; END IF;

  -- ── materials (+ seeded price for the supply rows) ──
  res := fn_bootstrap_materials_from_import(imp, jsonb_build_array(
    jsonb_build_object('name','Sharp sand','unit','m3','price','11100','row_ids', jsonb_build_array(r_sand)),
    jsonb_build_object('name','Roofing sheet 0.55mm','unit','m2','price','12500','row_ids', jsonb_build_array(r_roof))));
  IF (res->>'created')::int <> 2 OR (res->>'priced')::int <> 2 THEN
    RAISE WARNING 'bootstrap materials res=%', res; fails:=fails+1; END IF;
  SELECT id INTO u FROM materials_catalog WHERE org_id = org_a AND lower(name) = 'sharp sand';
  IF u IS NULL THEN RAISE WARNING 'material not created'; fails:=fails+1; END IF;
  SELECT current_price(org_a, u) INTO q;
  IF q <> 11100 THEN RAISE WARNING 'seeded price=% (expected 11100)', q; fails:=fails+1; END IF;
  SELECT mapped_material_id INTO u FROM boq_import_rows WHERE id = r_sand;
  IF u IS NULL THEN RAISE WARNING 'row not auto-mapped after bootstrap'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM material_aliases WHERE org_id = org_a AND lower(alias_text) LIKE '1630mm%';
  IF n <> 1 THEN RAISE WARNING 'alias not remembered'; fails:=fails+1; END IF;

  -- §7 guardrail: seeding a price from a COMPOSITE row must be refused.
  BEGIN
    PERFORM fn_bootstrap_materials_from_import(imp, jsonb_build_array(
      jsonb_build_object('name','Fake cement','unit','bag','price','195000','row_ids', jsonb_build_array(r_conc))));
    RAISE WARNING 'GUARDRAIL BREACH: composite rate seeded a material price'; fails:=fails+1;
  EXCEPTION WHEN raise_exception THEN NULL;
  END;

  -- ── progress fn writes ──
  PERFORM fn_boq_import_progress(imp, '{"step":"enriching","done":3,"total":15}');
  SELECT (progress->>'done')::int INTO n FROM boq_imports WHERE id = imp;
  IF n <> 3 THEN RAISE WARNING 'progress not stored'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'BOQ BOOTSTRAP FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'BOQ BOOTSTRAP PASS: stages fuzzy+append no-dup; materials+seeded prices (supply only); rows mapped; aliases; guardrail; progress.';
END $$;
ROLLBACK;
SELECT 'BOQ bootstrap: PASS' AS result;
