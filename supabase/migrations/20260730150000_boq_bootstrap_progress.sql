-- BOQ bootstrap + live progress (founder-approved flow, 2026-07-30).
-- The bill is the SETUP TOOL for a young org: one call creates/assigns stages
-- from the bill's elements (fuzzy-matching stages the user already designed —
-- never restructuring them), one call creates catalog materials from the AI's
-- guesses and — for genuine supply rows only — seeds their price (an explicit
-- human confirm, labelled all-in). Plus a progress field the edge function
-- updates while extracting, so the wizard can show real progress and survive a
-- dropped connection.

ALTER TABLE boq_imports    ADD COLUMN progress JSONB;
ALTER TABLE boq_import_rows ADD COLUMN row_no INT;   -- document order (review + element sequence)

-- ── live progress (edge fn → row → polled by the wizard) ─────────────────────
CREATE OR REPLACE FUNCTION fn_boq_import_progress(p_import uuid, p_progress jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);
  UPDATE boq_imports SET progress = p_progress WHERE id = p_import;
END $$;
REVOKE EXECUTE ON FUNCTION fn_boq_import_progress(uuid, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_boq_import_progress(uuid, jsonb) TO authenticated;

-- fn_stage_boq_rows_v2: also persist row_no (document order).
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
     mix_ratio, material_guess, flags, field_confidence, model_id, row_no)
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
         NULLIF(r->>'row_no','')::int
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

-- ── bootstrap 1: stages from the bill's elements ─────────────────────────────
-- Fuzzy-map each element to an EXISTING stage (exact, then containment, on the
-- cleaned element name); create stages only for unmatched elements, appended
-- after the user's own sequence (a designed recipe is never restructured).
-- Every item row gets suggested_stage_id for its element.
CREATE OR REPLACE FUNCTION fn_bootstrap_stages_from_import(p_import uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_type uuid; el record; v_stage uuid; v_name text;
  v_seq int; created int := 0; assigned int := 0;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  IF v_type IS NULL THEN RAISE EXCEPTION 'import % has no target building type', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);
  SELECT COALESCE(MAX(sequence), 0) INTO v_seq FROM type_stages WHERE building_type_id = v_type;

  FOR el IN
    SELECT section_path[1] AS element, MIN(row_no) AS first_row
      FROM boq_import_rows
     WHERE import_id = p_import AND row_kind = 'item' AND section_path[1] IS NOT NULL
     GROUP BY section_path[1] ORDER BY MIN(row_no) NULLS LAST
  LOOP
    -- "ELEMENT NO. 15 — ELECTRICAL INSTALLATIONS — L10:…" → "ELECTRICAL INSTALLATIONS"
    v_name := split_part(trim(both ' -—–' from regexp_replace(
                regexp_replace(el.element, '\(ALL PROVISIONAL\)', '', 'gi'),
                '^\s*ELEMENT\s*(NO\.?)?\s*\d+\s*[—–-]*\s*', '', 'i')), ' — ', 1);
    IF v_name = '' THEN v_name := el.element; END IF;

    SELECT id INTO v_stage FROM type_stages
     WHERE building_type_id = v_type
       AND (lower(name) = lower(v_name)
            OR position(lower(v_name) IN lower(name)) > 0
            OR position(lower(name) IN lower(v_name)) > 0)
     ORDER BY (lower(name) = lower(v_name)) DESC, sequence LIMIT 1;

    IF v_stage IS NULL THEN
      v_seq := v_seq + 1;
      v_stage := fn_add_type_stage(v_type, initcap(lower(v_name)), v_seq);
      created := created + 1;
    END IF;

    UPDATE boq_import_rows
       SET suggested_stage_id = v_stage
     WHERE import_id = p_import AND row_kind = 'item'
       AND section_path[1] = el.element AND suggested_stage_id IS NULL;
    GET DIAGNOSTICS v_seq = ROW_COUNT;  -- reuse var briefly
    assigned := assigned + v_seq;
    SELECT COALESCE(MAX(sequence), 0) INTO v_seq FROM type_stages WHERE building_type_id = v_type;
  END LOOP;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'bootstrap_stages', 'boq_imports', p_import,
          jsonb_build_object('created', created, 'assigned', assigned));
  RETURN jsonb_build_object('created', created, 'assigned', assigned);
END $$;
REVOKE EXECUTE ON FUNCTION fn_bootstrap_stages_from_import(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_bootstrap_stages_from_import(uuid) TO authenticated;

-- ── bootstrap 2: catalog materials (+ optional seeded price) from the bill ───
-- p_selections: [{name, unit, price?, row_ids: [uuid…]}] — each a HUMAN-edited
-- confirmation. Material creation goes through fn_upsert_material (admin-gated,
-- as everywhere else). §7 guardrail server-side: a price may only be seeded when
-- at least one selected row is a material_supply item carrying that rate — an
-- all-in composite/labour rate can never enter material_prices this way.
CREATE OR REPLACE FUNCTION fn_bootstrap_materials_from_import(p_import uuid, p_selections jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; sel jsonb; rid uuid; v_mat uuid; v_price numeric;
  created int := 0; priced int := 0; mapped int := 0; supply_ok boolean;
BEGIN
  SELECT org_id INTO v_org FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  FOR sel IN SELECT jsonb_array_elements(p_selections) LOOP
    IF NULLIF(trim(sel->>'name'), '') IS NULL OR NULLIF(trim(sel->>'unit'), '') IS NULL THEN
      RAISE EXCEPTION 'material name and unit are required';
    END IF;
    v_mat := fn_upsert_material(v_org, trim(sel->>'name'), trim(sel->>'unit'));
    created := created + 1;

    v_price := NULLIF(sel->>'price','')::numeric;
    IF v_price IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1 FROM boq_import_rows br
         WHERE br.import_id = p_import AND br.row_kind = 'item'
           AND br.suggested_kind = 'material_supply' AND br.parsed_rate IS NOT NULL
           AND br.id IN (SELECT jsonb_array_elements_text(sel->'row_ids')::uuid)
      ) INTO supply_ok;
      IF NOT supply_ok THEN
        RAISE EXCEPTION 'price for "%" refused: only genuine supply rows may seed a price (composite/labour rates are all-in)', sel->>'name';
      END IF;
      PERFORM fn_set_material_price(v_org, v_mat, v_price);
      priced := priced + 1;
    END IF;

    FOR rid IN SELECT jsonb_array_elements_text(sel->'row_ids')::uuid LOOP
      UPDATE boq_import_rows SET mapped_material_id = v_mat
       WHERE id = rid AND import_id = p_import AND row_kind = 'item';
      IF FOUND THEN
        mapped := mapped + 1;
        INSERT INTO material_aliases (org_id, material_id, alias_text)
        SELECT v_org, v_mat, raw_text FROM boq_import_rows WHERE id = rid AND length(trim(raw_text)) > 0
        ON CONFLICT (org_id, lower(alias_text)) DO UPDATE SET material_id = EXCLUDED.material_id;
      END IF;
    END LOOP;
  END LOOP;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'bootstrap_materials', 'boq_imports', p_import,
          jsonb_build_object('created', created, 'priced', priced, 'rows_mapped', mapped));
  RETURN jsonb_build_object('created', created, 'priced', priced, 'rows_mapped', mapped);
END $$;
REVOKE EXECUTE ON FUNCTION fn_bootstrap_materials_from_import(uuid, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_bootstrap_materials_from_import(uuid, jsonb) TO authenticated;
