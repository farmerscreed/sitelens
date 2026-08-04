-- Workbook ingest v3 (2026-08-03): split material/labour rate capture + workbook
-- check values.
--
-- 1. Split-rate bills ("Material Rate | Labour Rate | Total Rate") are the second
--    real document class the founder receives. The components now survive the
--    whole chain: staged rows carry parsed_rate_material/parsed_rate_labour,
--    confirmed work items carry boq_rate_material/boq_rate_labour (boq_rate stays
--    the ALL-IN reference, Rule 4 unchanged — reference only, never live cost).
-- 2. §7 guardrail UPGRADED, not relaxed: price proposals from supply rows now
--    prefer the bill's material-only rate over the all-in rate — a BETTER price
--    signal; composite/labour rates still never reach material_prices.
-- 3. boq_check_values: a workbook's own answer keys (materials schedule, rebar
--    summary, summary totals) stored per recipe and compared LIVE against the
--    computed take-off (type_takeoff_check view). The bill grades our recipe the
--    same way it already grades our extraction (§5 reconciliation philosophy).
-- Rules: no client write policies anywhere (Rule 1); check values and mappings
-- are human-confirmed inputs (Rule 3); comparisons are computed live (Rule 4).

-- ── 1. rate components on the staging + work-item chain ──────────────────────
ALTER TABLE boq_import_rows
  ADD COLUMN parsed_rate_material NUMERIC,
  ADD COLUMN parsed_rate_labour   NUMERIC;

ALTER TABLE type_work_items
  ADD COLUMN boq_rate_material NUMERIC,
  ADD COLUMN boq_rate_labour   NUMERIC;

-- fn_stage_boq_rows_v2: persist the rate components (payload keys are optional —
-- single-rate bills and the AI lane simply omit them).
CREATE OR REPLACE FUNCTION fn_stage_boq_rows_v2(
  p_import uuid, p_rows jsonb,
  p_document_totals jsonb DEFAULT NULL, p_reconciliation jsonb DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_type uuid; n int;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  INSERT INTO boq_import_rows
    (import_id, raw_text, parsed_qty, parsed_unit, parsed_rate, mapped_material_id,
     confidence, status, row_kind, boq_ref, section_path, resolved_text, amount,
     unit_normalized, is_provisional, is_priced, suggested_stage_id, suggested_kind,
     mix_ratio, material_guess, flags, field_confidence, model_id, row_no,
     parsed_rate_material, parsed_rate_labour)
  SELECT p_import,
         r->>'raw_text',
         NULLIF(r->>'parsed_qty','')::numeric,
         r->>'parsed_unit',
         NULLIF(r->>'parsed_rate','')::numeric,
         NULLIF(r->>'mapped_material_id','')::uuid,
         NULLIF(r->>'confidence','')::numeric,
         'proposed',
         COALESCE(NULLIF(r->>'row_kind','')::boq_row_kind, 'item'),
         NULLIF(r->>'boq_ref',''),
         CASE WHEN r ? 'section_path'
              THEN ARRAY(SELECT jsonb_array_elements_text(r->'section_path')) END,
         NULLIF(r->>'resolved_text',''),
         NULLIF(r->>'amount','')::numeric,
         fn_normalize_unit(r->>'parsed_unit'),
         COALESCE((r->>'is_provisional')::boolean, false),
         COALESCE((r->>'is_priced')::boolean,
                  NULLIF(r->>'parsed_rate','') IS NOT NULL),
         (SELECT s.id FROM type_stages s
           WHERE s.id = NULLIF(r->>'suggested_stage_id','')::uuid
             AND s.building_type_id = v_type),
         NULLIF(r->>'suggested_kind','')::work_item_kind,
         NULLIF(r->>'mix_ratio',''),
         NULLIF(r->>'material_guess',''),
         COALESCE(r->'flags', '[]'::jsonb)
           || CASE WHEN NULLIF(r->>'parsed_unit','') IS NOT NULL
                    AND fn_normalize_unit(r->>'parsed_unit') IS NULL
                    AND NOT (COALESCE(r->'flags','[]'::jsonb) ? 'unknown_unit')
                   THEN '["unknown_unit"]'::jsonb ELSE '[]'::jsonb END,
         r->'field_confidence',
         NULLIF(r->>'model_id',''),
         NULLIF(r->>'row_no','')::int,
         NULLIF(r->>'parsed_rate_material','')::numeric,
         NULLIF(r->>'parsed_rate_labour','')::numeric
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS n = ROW_COUNT;

  UPDATE boq_import_rows br
     SET mapped_material_id = COALESCE(
           fn_resolve_material(v_org, br.resolved_text),
           fn_resolve_material(v_org, br.raw_text))
   WHERE br.import_id = p_import AND br.row_kind = 'item'
     AND br.mapped_material_id IS NULL
     AND COALESCE(fn_resolve_material(v_org, br.resolved_text),
                  fn_resolve_material(v_org, br.raw_text)) IS NOT NULL;

  UPDATE boq_imports
     SET status          = 'review',
         document_totals = COALESCE(p_document_totals, document_totals),
         reconciliation  = COALESCE(p_reconciliation, reconciliation),
         priced_total    = (SELECT COALESCE(SUM(parsed_qty * parsed_rate), 0)
                              FROM boq_import_rows
                             WHERE import_id = p_import AND row_kind = 'item'
                               AND is_priced AND parsed_qty IS NOT NULL
                               AND parsed_rate IS NOT NULL),
         unpriced_count  = (SELECT COUNT(*) FROM boq_import_rows
                             WHERE import_id = p_import AND row_kind = 'item'
                               AND NOT is_priced)
   WHERE id = p_import;
  RETURN n;
END $$;

-- fn_confirm_boq_import_v2: carry the components onto the work item (from the
-- STAGED row — the client edits qty/kind/mapping, never invents rate splits).
CREATE OR REPLACE FUNCTION fn_confirm_boq_import_v2(p_import uuid, p_items jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_type uuid; c jsonb; n int := 0; v_mem uuid;
  r boq_import_rows%ROWTYPE; v_stage uuid; v_kind work_item_kind;
  v_material uuid; v_assembly uuid; v_qty numeric; v_unit text; v_rate numeric;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  IF v_type IS NULL THEN RAISE EXCEPTION 'import % has no target building type', p_import; END IF;
  v_mem := fn_require_org_manager(v_org);

  FOR c IN SELECT jsonb_array_elements(p_items) LOOP
    SELECT * INTO r FROM boq_import_rows
     WHERE id = (c->>'row_id')::uuid AND import_id = p_import;
    IF r.id IS NULL THEN RAISE EXCEPTION 'row % is not in import %', c->>'row_id', p_import; END IF;
    IF r.row_kind <> 'item' THEN RAISE EXCEPTION 'row % is a %, not an item', r.id, r.row_kind; END IF;

    v_stage    := NULLIF(c->>'stage_id','')::uuid;
    v_kind     := COALESCE(NULLIF(c->>'kind','')::work_item_kind, r.suggested_kind, 'other');
    v_material := NULLIF(c->>'material_id','')::uuid;
    v_assembly := NULLIF(c->>'assembly_id','')::uuid;
    v_qty      := COALESCE(NULLIF(c->>'quantity','')::numeric, r.parsed_qty);
    v_unit     := COALESCE(NULLIF(c->>'unit',''), r.unit_normalized, r.parsed_unit);
    v_rate     := COALESCE(NULLIF(c->>'boq_rate','')::numeric, r.parsed_rate);

    IF v_stage IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM type_stages WHERE id = v_stage AND building_type_id = v_type) THEN
      RAISE EXCEPTION 'stage % is not in type %', v_stage, v_type;
    END IF;
    IF v_material IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM materials_catalog WHERE id = v_material AND org_id = v_org) THEN
      RAISE EXCEPTION 'material % is not in the org', v_material USING errcode = '42501';
    END IF;
    IF v_assembly IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM assemblies WHERE id = v_assembly AND org_id = v_org) THEN
      RAISE EXCEPTION 'assembly % is not in the org', v_assembly USING errcode = '42501';
    END IF;

    INSERT INTO type_work_items
      (building_type_id, stage_id, source_row_id, element_name, section_name, boq_ref,
       description, quantity, unit, kind, assembly_id, material_id, boq_rate,
       boq_rate_material, boq_rate_labour,
       is_priced, is_provisional, source, confidence, model_id, verified_by)
    VALUES
      (v_type, v_stage, r.id, r.section_path[1], r.section_path[2], r.boq_ref,
       COALESCE(NULLIF(c->>'description',''), r.resolved_text, r.raw_text),
       v_qty, v_unit, v_kind, v_assembly, v_material, v_rate,
       r.parsed_rate_material, r.parsed_rate_labour,
       r.is_priced, r.is_provisional, 'boq_import', r.confidence, r.model_id, v_mem)
    ON CONFLICT (source_row_id) WHERE source_row_id IS NOT NULL
      DO UPDATE SET stage_id = EXCLUDED.stage_id, quantity = EXCLUDED.quantity,
        unit = EXCLUDED.unit, kind = EXCLUDED.kind, assembly_id = EXCLUDED.assembly_id,
        material_id = EXCLUDED.material_id, boq_rate = EXCLUDED.boq_rate,
        boq_rate_material = EXCLUDED.boq_rate_material,
        boq_rate_labour = EXCLUDED.boq_rate_labour,
        description = EXCLUDED.description, verified_by = EXCLUDED.verified_by;

    IF v_material IS NOT NULL AND length(trim(r.raw_text)) > 0 THEN
      INSERT INTO material_aliases (org_id, material_id, alias_text)
      VALUES (v_org, v_material, r.raw_text)
      ON CONFLICT (org_id, lower(alias_text)) DO UPDATE SET material_id = EXCLUDED.material_id;
    END IF;
    UPDATE boq_import_rows SET status = 'confirmed', mapped_material_id = v_material WHERE id = r.id;
    n := n + 1;
  END LOOP;

  INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit)
  SELECT v_type, wi.stage_id, wi.material_id, SUM(wi.quantity), MAX(wi.unit)
    FROM type_work_items wi
    JOIN boq_import_rows br ON br.id = wi.source_row_id
   WHERE br.import_id = p_import AND wi.kind = 'material_supply'
     AND wi.material_id IS NOT NULL AND wi.quantity IS NOT NULL
   GROUP BY wi.stage_id, wi.material_id
  ON CONFLICT (building_type_id, stage_id, material_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit;

  UPDATE boq_imports SET status = 'confirmed' WHERE id = p_import;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'confirm_boq_import_v2', 'boq_imports', p_import,
          jsonb_build_object('work_items', n));
  RETURN n;
END $$;

-- §7 guardrail upgraded: supply rows with a split rate propose the MATERIAL
-- component (the bill already separated out labour); all-in rates keep their
-- warning label. Composite/labour/plant rows still never reach material_prices.
CREATE OR REPLACE FUNCTION fn_propose_prices_from_import(p_import uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; r record; n int := 0;
BEGIN
  SELECT org_id INTO v_org FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  FOR r IN
    SELECT br.id, br.mapped_material_id, br.parsed_rate, br.parsed_rate_material,
           br.unit_normalized, br.parsed_unit, br.raw_text, br.confidence
      FROM boq_import_rows br
     WHERE br.import_id = p_import
       AND br.row_kind = 'item'
       AND br.suggested_kind = 'material_supply'      -- THE guardrail
       AND br.mapped_material_id IS NOT NULL
       AND COALESCE(br.parsed_rate_material, br.parsed_rate) IS NOT NULL
       AND COALESCE(br.parsed_rate_material, br.parsed_rate) > 0
  LOOP
    PERFORM fn_record_inference(
      v_org, 'price_proposal',
      jsonb_build_object(
        'material_id', r.mapped_material_id,
        'proposed_price', COALESCE(r.parsed_rate_material, r.parsed_rate),
        'unit', COALESCE(r.unit_normalized, r.parsed_unit),
        'from_text', r.raw_text,
        'import_id', p_import,
        'current_price', current_price(v_org, r.mapped_material_id),
        'note', CASE WHEN r.parsed_rate_material IS NOT NULL
                     THEN 'Material-only BOQ rate (the bill separates labour) — still includes delivery'
                     ELSE 'All-in BOQ rate (may include delivery/labour) — compare before accepting' END),
      NULL, NULL, r.id, NULL, r.confidence, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- ── 2. workbook check values — the document's own answer keys ────────────────
CREATE TABLE boq_check_values (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  source_sheet     TEXT NOT NULL,                 -- "Materials Schedule", "Rebar Summary", …
  section          TEXT,
  label            TEXT NOT NULL,                 -- the row as written
  unit             TEXT,
  qty              NUMERIC,                       -- quantity check (schedules)
  amount           NUMERIC,                       -- money check (summaries), ₦
  material_id      UUID REFERENCES materials_catalog(id) ON DELETE SET NULL,
  created_by       UUID REFERENCES memberships(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_check_values_type ON boq_check_values(building_type_id);

ALTER TABLE boq_check_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY boq_check_values_select ON boq_check_values FOR SELECT
  USING (org_id = current_org_id());
GRANT SELECT ON boq_check_values TO authenticated;

-- Replace-by-sheet semantics: re-capturing a sheet is idempotent, never additive.
-- Labels auto-map through alias memory (fn_resolve_material); unmatched rows stay
-- unmapped until a human maps them (fn_map_boq_check_value).
CREATE OR REPLACE FUNCTION fn_set_boq_check_values(p_type uuid, p_sheet text, p_rows jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid; n int;
BEGIN
  SELECT org_id INTO v_org FROM building_types WHERE id = p_type;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  v_mem := fn_require_org_manager(v_org);
  IF NULLIF(trim(p_sheet), '') IS NULL THEN RAISE EXCEPTION 'sheet name is required'; END IF;

  DELETE FROM boq_check_values WHERE building_type_id = p_type AND source_sheet = p_sheet;

  INSERT INTO boq_check_values
    (org_id, building_type_id, source_sheet, section, label, unit, qty, amount, material_id, created_by)
  SELECT v_org, p_type, p_sheet,
         NULLIF(r->>'section',''),
         r->>'label',
         NULLIF(r->>'unit',''),
         NULLIF(r->>'qty','')::numeric,
         NULLIF(r->>'amount','')::numeric,
         fn_resolve_material(v_org, r->>'label'),
         v_mem
    FROM jsonb_array_elements(p_rows) AS r
   WHERE NULLIF(trim(r->>'label'), '') IS NOT NULL
     AND (NULLIF(r->>'qty','') IS NOT NULL OR NULLIF(r->>'amount','') IS NOT NULL);
  GET DIAGNOSTICS n = ROW_COUNT;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'set_boq_check_values', 'building_types', p_type,
          jsonb_build_object('sheet', p_sheet, 'rows', n));
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION fn_set_boq_check_values(uuid, text, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_boq_check_values(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION fn_map_boq_check_value(p_id uuid, p_material uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM boq_check_values WHERE id = p_id;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown check value %', p_id; END IF;
  PERFORM fn_require_org_manager(v_org);
  IF p_material IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM materials_catalog WHERE id = p_material AND org_id = v_org) THEN
    RAISE EXCEPTION 'material % is not in the org', p_material USING errcode = '42501';
  END IF;
  UPDATE boq_check_values SET material_id = p_material WHERE id = p_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_map_boq_check_value(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_map_boq_check_value(uuid, uuid) TO authenticated;

-- Live comparison: stated (converted to the material's stock unit) vs the
-- computed take-off. NULL variance = not comparable yet (unmapped material or
-- missing unit bridge) — surfaced, never guessed (Rule 2 in spirit).
CREATE OR REPLACE VIEW type_takeoff_check WITH (security_invoker = true) AS
SELECT cv.id, cv.org_id, cv.building_type_id, cv.source_sheet, cv.section,
       cv.label, cv.unit, cv.qty AS stated_qty, cv.amount AS stated_amount,
       cv.material_id,
       fn_convert_to_material_unit(cv.material_id, cv.qty, cv.unit) AS stated_qty_converted,
       t.qty_required AS computed_qty,
       CASE WHEN cv.material_id IS NOT NULL AND cv.qty IS NOT NULL
             AND t.qty_required IS NOT NULL AND t.qty_required <> 0
             AND fn_convert_to_material_unit(cv.material_id, cv.qty, cv.unit) IS NOT NULL
            THEN ROUND(((fn_convert_to_material_unit(cv.material_id, cv.qty, cv.unit) - t.qty_required)
                        / t.qty_required) * 100, 1)
       END AS variance_pct
FROM boq_check_values cv
LEFT JOIN (SELECT building_type_id, material_id, SUM(qty_required) AS qty_required
             FROM type_material_takeoff GROUP BY building_type_id, material_id) t
  ON t.building_type_id = cv.building_type_id AND t.material_id = cv.material_id;
GRANT SELECT ON type_takeoff_check TO authenticated;
