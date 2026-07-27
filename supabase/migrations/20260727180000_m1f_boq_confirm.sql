-- M1 · F — Confirm a BOQ import into a type's recipe + item-mapping memory
-- (F-BOQ-3/4, AC-5). AI/parse proposes; a human confirms; only then does it become
-- a committed recipe row (Rule 3). The confirm is the ONLY write path into
-- type_boq_items from an import, and is idempotent.

-- Resolve a raw item text to a catalogue material: a remembered alias first, else an
-- exact catalogue-name match. This is the memory that makes the system map almost
-- everything on its own after a few projects (F-BOQ-3).
CREATE OR REPLACE FUNCTION fn_resolve_material(p_org uuid, p_text text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT material_id FROM material_aliases
      WHERE org_id = p_org AND lower(alias_text) = lower(trim(p_text)) LIMIT 1),
    (SELECT id FROM materials_catalog
      WHERE org_id = p_org AND lower(name) = lower(trim(p_text)) AND archived_at IS NULL LIMIT 1)
  );
$$;
REVOKE EXECUTE ON FUNCTION fn_resolve_material(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_resolve_material(uuid, text) TO authenticated;

-- Extend staging (from D) to AUTO-MAP unfamiliar rows against known aliases/catalogue
-- names, so the second import of the same item text arrives already mapped (F-BOQ-3).
CREATE OR REPLACE FUNCTION fn_stage_boq_rows(p_import uuid, p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; n int;
BEGIN
  SELECT org_id INTO v_org FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  INSERT INTO boq_import_rows
    (import_id, raw_text, parsed_qty, parsed_unit, parsed_rate, mapped_material_id, confidence, status)
  SELECT p_import,
         r->>'raw_text',
         NULLIF(r->>'parsed_qty','')::numeric,
         r->>'parsed_unit',
         NULLIF(r->>'parsed_rate','')::numeric,
         NULLIF(r->>'mapped_material_id','')::uuid,
         NULLIF(r->>'confidence','')::numeric,
         'proposed'
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Auto-map from memory (alias / catalogue name) any row the caller didn't map.
  UPDATE boq_import_rows br
     SET mapped_material_id = fn_resolve_material(v_org, br.raw_text)
   WHERE br.import_id = p_import
     AND br.mapped_material_id IS NULL
     AND fn_resolve_material(v_org, br.raw_text) IS NOT NULL;

  UPDATE boq_imports SET status = 'review' WHERE id = p_import;
  RETURN n;
END $$;

-- ── confirm: write confirmed rows into the recipe + remember aliases (atomic) ─
-- p_confirmations: jsonb array of
--   {row_id, material_id, quantity, unit, stage_id?}
-- Idempotent: type_boq_items upsert on (type,stage,material); aliases upsert on
-- (org, lower(alias_text)). Re-running does not duplicate.
CREATE OR REPLACE FUNCTION fn_confirm_boq_import(p_import uuid, p_confirmations jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_type uuid; c jsonb; n int := 0;
  v_row uuid; v_material uuid; v_qty numeric; v_unit text; v_stage uuid; v_raw text;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  IF v_type IS NULL THEN RAISE EXCEPTION 'import % has no target building type', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  FOR c IN SELECT jsonb_array_elements(p_confirmations) LOOP
    v_row      := (c->>'row_id')::uuid;
    v_material := (c->>'material_id')::uuid;
    v_qty      := (c->>'quantity')::numeric;
    v_unit     := c->>'unit';
    v_stage    := NULLIF(c->>'stage_id','')::uuid;

    SELECT raw_text INTO v_raw FROM boq_import_rows WHERE id = v_row AND import_id = p_import;
    IF v_raw IS NULL THEN RAISE EXCEPTION 'row % is not in import %', v_row, p_import; END IF;
    IF NOT EXISTS (SELECT 1 FROM materials_catalog WHERE id = v_material AND org_id = v_org) THEN
      RAISE EXCEPTION 'material % is not in the org', v_material USING errcode = '42501';
    END IF;
    IF v_stage IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM type_stages WHERE id = v_stage AND building_type_id = v_type) THEN
      RAISE EXCEPTION 'stage % is not in type %', v_stage, v_type;
    END IF;

    -- Recipe quantity (Rule 4: no price here). Idempotent upsert.
    INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit)
    VALUES (v_type, v_stage, v_material, v_qty, v_unit)
    ON CONFLICT (building_type_id, stage_id, material_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit;

    -- Remember the mapping (idempotent).
    IF length(trim(v_raw)) > 0 THEN
      INSERT INTO material_aliases (org_id, material_id, alias_text)
      VALUES (v_org, v_material, v_raw)
      ON CONFLICT (org_id, lower(alias_text)) DO UPDATE SET material_id = EXCLUDED.material_id;
    END IF;

    UPDATE boq_import_rows SET status = 'confirmed', mapped_material_id = v_material WHERE id = v_row;
    n := n + 1;
  END LOOP;

  UPDATE boq_imports SET status = 'confirmed' WHERE id = p_import;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'confirm_boq_import', 'boq_imports', p_import,
          jsonb_build_object('confirmed_rows', n));
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION fn_confirm_boq_import(uuid, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_confirm_boq_import(uuid, jsonb) TO authenticated;
