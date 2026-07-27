-- M1 · D — BOQ import staging + per-org column-mapping memory (F-BOQ-1).
-- boq_imports / boq_import_rows have NO client write policy (M0) — writes go through
-- the SECURITY DEFINER functions below (Rule 1 / Rule 3: rows are proposals).

-- Remembers which spreadsheet columns mean item/qty/unit/rate for a given header
-- layout, so the next upload in the same format maps automatically (F-BOQ-1).
CREATE TABLE boq_column_mappings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  header_signature TEXT NOT NULL,            -- stable hash of the header row
  mapping          JSONB NOT NULL,           -- e.g. {"item":0,"quantity":2,"unit":3,"rate":4}
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, header_signature)
);
ALTER TABLE boq_column_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY boq_column_mappings_select ON boq_column_mappings FOR SELECT
  USING (org_id = current_org_id());
GRANT SELECT ON boq_column_mappings TO authenticated;

-- ── create an import record ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_create_boq_import(
  p_org uuid, p_building_type uuid, p_format text, p_source_media uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  IF p_building_type IS NOT NULL AND fn__type_org(p_building_type) <> p_org THEN
    RAISE EXCEPTION 'building type % is not in org %', p_building_type, p_org;
  END IF;
  INSERT INTO boq_imports (org_id, building_type_id, source_media_id, format, status, imported_by)
  VALUES (p_org, p_building_type, p_source_media, p_format, 'uploaded', v_mem)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_create_boq_import(uuid, uuid, text, uuid) TO authenticated;

-- ── stage parsed/extracted rows as PROPOSALS (Rule 3) ───────────────────────
-- p_rows: jsonb array of {raw_text, parsed_qty, parsed_unit, parsed_rate,
--                         mapped_material_id?, confidence?}
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

  UPDATE boq_imports SET status = 'review' WHERE id = p_import;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION fn_stage_boq_rows(uuid, jsonb) TO authenticated;

-- ── remember a column mapping for a header layout ───────────────────────────
CREATE OR REPLACE FUNCTION fn_remember_column_mapping(p_org uuid, p_signature text, p_mapping jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM fn_require_org_manager(p_org);
  INSERT INTO boq_column_mappings (org_id, header_signature, mapping)
  VALUES (p_org, p_signature, p_mapping)
  ON CONFLICT (org_id, header_signature) DO UPDATE SET mapping = EXCLUDED.mapping;
END $$;
GRANT EXECUTE ON FUNCTION fn_remember_column_mapping(uuid, text, jsonb) TO authenticated;
