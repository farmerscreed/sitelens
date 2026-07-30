-- Phase 0 hotfix (docs/BOQ_TRUE_COST_DESIGN.md v2 §9) — two live bugs in the BOQ
-- confirm path found by the QS review of the real NPC Xora Bay bill.
--
--   BUG 1  fn_confirm_boq_import upserted row-by-row with
--          DO UPDATE SET quantity = EXCLUDED.quantity, so several BOQ lines
--          confirming into the same (stage, material) kept only the LAST quantity
--          (sample: five rebar lines Σ ≈ 8.98 t collapsed to 0.89 t).
--   BUG 2  uq_type_boq_item was a plain unique index; NULL stage_ids are distinct,
--          so stage-less confirms bypassed ON CONFLICT and duplicated on re-run.

-- ── BUG 2 fix: NULL-stage rows must participate in the conflict ──────────────
-- Merge any duplicates the old index allowed. Dupes can only have come from
-- identical re-confirms of NULL-stage rows (replace semantics), so the surviving
-- row's quantity is the right one; keep the lowest id deterministically.
DELETE FROM type_boq_items t
USING type_boq_items d
WHERE t.building_type_id = d.building_type_id
  AND t.material_id = d.material_id
  AND t.stage_id IS NOT DISTINCT FROM d.stage_id
  AND t.id > d.id;

DROP INDEX IF EXISTS uq_type_boq_item;
CREATE UNIQUE INDEX uq_type_boq_item
  ON type_boq_items (building_type_id, stage_id, material_id) NULLS NOT DISTINCT;

-- ── BUG 1 fix: aggregate confirmations BEFORE the upsert ─────────────────────
-- Within one confirm call, rows mapping to the same (stage, material) SUM.
-- Re-running the same call is a no-op (idempotent). A later import's confirm
-- still REPLACES the recipe quantity (recipe = latest confirmed design).
CREATE OR REPLACE FUNCTION fn_confirm_boq_import(p_import uuid, p_confirmations jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_type uuid; c jsonb; n int := 0;
  v_row uuid; v_material uuid; v_stage uuid; v_raw text;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  IF v_type IS NULL THEN RAISE EXCEPTION 'import % has no target building type', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  -- Per-row validation + alias memory + row status (unchanged behaviour).
  FOR c IN SELECT jsonb_array_elements(p_confirmations) LOOP
    v_row      := (c->>'row_id')::uuid;
    v_material := (c->>'material_id')::uuid;
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

    -- Remember the mapping (idempotent).
    IF length(trim(v_raw)) > 0 THEN
      INSERT INTO material_aliases (org_id, material_id, alias_text)
      VALUES (v_org, v_material, v_raw)
      ON CONFLICT (org_id, lower(alias_text)) DO UPDATE SET material_id = EXCLUDED.material_id;
    END IF;

    UPDATE boq_import_rows SET status = 'confirmed', mapped_material_id = v_material WHERE id = v_row;
    n := n + 1;
  END LOOP;

  -- Quantities may only sum when their units agree (never add bags to tons).
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_confirmations) r
    GROUP BY NULLIF(r->>'stage_id','')::uuid, (r->>'material_id')::uuid
    HAVING count(DISTINCT COALESCE(NULLIF(trim(r->>'unit'), ''), '?')) > 1
  ) THEN
    RAISE EXCEPTION 'rows mapped to the same material and stage carry different units — align the units before confirming';
  END IF;

  -- Recipe quantities (Rule 4: no price here). Aggregated, idempotent upsert.
  INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit)
  SELECT v_type,
         NULLIF(r->>'stage_id','')::uuid,
         (r->>'material_id')::uuid,
         SUM((r->>'quantity')::numeric),
         MAX(r->>'unit')
  FROM jsonb_array_elements(p_confirmations) r
  GROUP BY 2, 3
  ON CONFLICT (building_type_id, stage_id, material_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit;

  UPDATE boq_imports SET status = 'confirmed' WHERE id = p_import;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'confirm_boq_import', 'boq_imports', p_import,
          jsonb_build_object('confirmed_rows', n));
  RETURN n;
END $$;

-- Same grants as before (CREATE OR REPLACE preserves ACLs; restated for clarity).
REVOKE EXECUTE ON FUNCTION fn_confirm_boq_import(uuid, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_confirm_boq_import(uuid, jsonb) TO authenticated;
