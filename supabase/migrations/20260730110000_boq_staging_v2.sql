-- Phase 1 · BOQ staging v2 (docs/BOQ_TRUE_COST_DESIGN.md §3.1, §8).
-- A staged row is no longer just {text, qty, unit, rate}: it carries the document's
-- grammar — kind (only 'item' is confirmable), section hierarchy, S/N ref, the AMOUNT
-- check value, provisional/unpriced flags, AI suggestions, machine validation flags.
-- The import header carries the document's own totals and our reconciliation to them.

-- Work-item kind: defined now for suggestions; reused by type_work_items in Phase 2.
CREATE TYPE work_item_kind AS ENUM
  ('material_supply','composite','labour','plant','provisional','fitting','other');

CREATE TYPE boq_row_kind AS ENUM
  ('item','note','element_header','section_header','column_header',
   'collection','summary','title','footer');

ALTER TABLE boq_import_rows
  ADD COLUMN row_kind          boq_row_kind NOT NULL DEFAULT 'item',
  ADD COLUMN boq_ref           TEXT,
  ADD COLUMN section_path      TEXT[],
  ADD COLUMN resolved_text     TEXT,             -- ditto-resolved (raw_text stays verbatim)
  ADD COLUMN amount            NUMERIC(16,2),    -- the bill's AMOUNT cell (check value)
  ADD COLUMN unit_normalized   TEXT,             -- §8 dictionary result (raw kept in parsed_unit)
  ADD COLUMN is_provisional    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN is_priced         BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN suggested_stage_id UUID REFERENCES type_stages(id),
  ADD COLUMN suggested_kind    work_item_kind,
  ADD COLUMN mix_ratio         TEXT,             -- AI-read ratio ("1:3:6"), Rule 3: a proposal
  ADD COLUMN material_guess    TEXT,             -- AI's purchasable-material name guess
  ADD COLUMN flags             JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN field_confidence  JSONB,
  ADD COLUMN model_id          TEXT;             -- Rule 2: which model proposed this row

ALTER TABLE boq_imports
  ADD COLUMN document_totals   JSONB,            -- totals the document STATES (elements, grand)
  ADD COLUMN reconciliation    JSONB,            -- computed: extracted vs stated + variance
  ADD COLUMN priced_total      NUMERIC(16,2),    -- Σ item qty×rate where is_priced
  ADD COLUMN unpriced_count    INT;              -- measured items the bill did not price

-- ── §8 unit normalization dictionary (deterministic; unknown → NULL, caller flags) ──
CREATE OR REPLACE FUNCTION fn_normalize_unit(p_unit text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE regexp_replace(lower(coalesce(p_unit,'')), '[\s.,]', '', 'g')
    WHEN 'm2'  THEN 'm2' WHEN 'sqm' THEN 'm2' WHEN 'sm' THEN 'm2' WHEN 'm²' THEN 'm2'
    WHEN 'm3'  THEN 'm3' WHEN 'cum' THEN 'm3' WHEN 'm³' THEN 'm3'
    WHEN 't'   THEN 't'  WHEN 'ton' THEN 't' WHEN 'tons' THEN 't'
    WHEN 'ttons' THEN 't' WHEN 'tonne' THEN 't' WHEN 'tonnes' THEN 't'
    WHEN 'nr'  THEN 'nr' WHEN 'nrs' THEN 'nr' WHEN 'no' THEN 'nr'
    WHEN 'nos' THEN 'nr' WHEN 'number' THEN 'nr'
    WHEN 'm'   THEN 'm'  WHEN 'lm' THEN 'm' WHEN 'linm' THEN 'm'
    WHEN 'item' THEN 'item' WHEN 'ltem' THEN 'item' WHEN 'itm' THEN 'item'
    WHEN 'kg'  THEN 'kg' WHEN 'bag' THEN 'bag' WHEN 'bags' THEN 'bag'
    WHEN 'set' THEN 'set' WHEN 'sets' THEN 'set'
    WHEN 'sum' THEN 'sum' WHEN 'ls' THEN 'sum'
    WHEN 'pair' THEN 'pair' WHEN 'pairs' THEN 'pair'
    ELSE NULL
  END;
$$;
GRANT EXECUTE ON FUNCTION fn_normalize_unit(text) TO authenticated;

-- ── stage v2 rows (Rule 3: everything is a proposal; only the server writes) ──
-- p_rows: jsonb array; v1 keys still accepted, v2 adds row_kind/boq_ref/section_path/
-- resolved_text/amount/is_provisional/is_priced/suggested_stage_id/suggested_kind/
-- mix_ratio/flags/field_confidence/model_id.
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
     mix_ratio, material_guess, flags, field_confidence, model_id)
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
             AND s.building_type_id = v_type),          -- suggestion must be in the type
         NULLIF(r->>'suggested_kind','')::work_item_kind,
         NULLIF(r->>'mix_ratio',''),
         NULLIF(r->>'material_guess',''),
         COALESCE(r->'flags', '[]'::jsonb)
           -- server-side backstop: unknown unit flagged even if the client missed it
           || CASE WHEN NULLIF(r->>'parsed_unit','') IS NOT NULL
                    AND fn_normalize_unit(r->>'parsed_unit') IS NULL
                    AND NOT (COALESCE(r->'flags','[]'::jsonb) ? 'unknown_unit')
                   THEN '["unknown_unit"]'::jsonb ELSE '[]'::jsonb END,
         r->'field_confidence',
         NULLIF(r->>'model_id','')
  FROM jsonb_array_elements(p_rows) AS r;
  GET DIAGNOSTICS n = ROW_COUNT;

  -- Auto-map ITEM rows from memory (alias / catalogue name), resolved text first.
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
REVOKE EXECUTE ON FUNCTION fn_stage_boq_rows_v2(uuid, jsonb, jsonb, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_stage_boq_rows_v2(uuid, jsonb, jsonb, jsonb) TO authenticated;
