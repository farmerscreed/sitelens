-- Assembly unit guard (founder incident, 2026-08-05 — DECISIONS #72): a per-m³
-- "Concrete mix 1:4" attached to a per-m² render line inflated one recipe line
-- by ₦82.96m. Humans pick wrong dropdown options weekly; the system's job is to
-- refuse. From now on an assembly whose OUTPUT unit does not match the work
-- item's unit cannot be attached — at confirm time and at edit time. Unknown
-- units (not in the dictionary) are tolerated: refuse only what is provably
-- wrong, never guess (Rule 2 in spirit).

-- ── shared check ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn__assert_assembly_unit(p_assembly uuid, p_item_unit text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_a_unit text; v_a_norm text; v_i_norm text; v_name text;
BEGIN
  IF p_assembly IS NULL THEN RETURN; END IF;
  SELECT unit, name INTO v_a_unit, v_name FROM assemblies WHERE id = p_assembly;
  v_a_norm := fn_normalize_unit(v_a_unit);
  v_i_norm := fn_normalize_unit(p_item_unit);
  IF v_a_norm IS NOT NULL AND v_i_norm IS NOT NULL AND v_a_norm <> v_i_norm THEN
    RAISE EXCEPTION 'mix "%" prices per % but this line is measured in % — pick a mix that outputs per %',
      v_name, v_a_norm, v_i_norm, v_i_norm;
  END IF;
END $$;

-- ── guard at EDIT time (fn_update_work_item, same 9-arg signature) ───────────
CREATE OR REPLACE FUNCTION fn_update_work_item(
  p_work_item uuid, p_kind work_item_kind DEFAULT NULL,
  p_assembly uuid DEFAULT NULL, p_material uuid DEFAULT NULL,
  p_clear_material boolean DEFAULT false, p_clear_assembly boolean DEFAULT false,
  p_in_scope boolean DEFAULT NULL,
  p_stage uuid DEFAULT NULL, p_clear_stage boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid; v_type uuid; v_old_stage uuid; v_old_mat uuid; v_kind work_item_kind; v_unit text;
BEGIN
  SELECT bt.org_id, wi.building_type_id, wi.stage_id, wi.material_id, wi.kind, wi.unit
    INTO v_org, v_type, v_old_stage, v_old_mat, v_kind, v_unit
    FROM type_work_items wi JOIN building_types bt ON bt.id = wi.building_type_id
   WHERE wi.id = p_work_item;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown work item %', p_work_item; END IF;
  v_mem := fn_require_org_manager(v_org);
  IF p_assembly IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM assemblies WHERE id = p_assembly AND org_id = v_org) THEN
    RAISE EXCEPTION 'assembly % is not in the org', p_assembly USING errcode = '42501';
  END IF;
  IF p_material IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM materials_catalog WHERE id = p_material AND org_id = v_org) THEN
    RAISE EXCEPTION 'material % is not in the org', p_material USING errcode = '42501';
  END IF;
  IF p_stage IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM type_stages WHERE id = p_stage AND building_type_id = v_type) THEN
    RAISE EXCEPTION 'stage % is not in this recipe', p_stage;
  END IF;
  PERFORM fn__assert_assembly_unit(p_assembly, v_unit);   -- THE guard

  UPDATE type_work_items SET
    kind        = COALESCE(p_kind, kind),
    assembly_id = CASE WHEN p_clear_assembly THEN NULL ELSE COALESCE(p_assembly, assembly_id) END,
    material_id = CASE WHEN p_clear_material THEN NULL ELSE COALESCE(p_material, material_id) END,
    in_scope    = COALESCE(p_in_scope, in_scope),
    stage_id    = CASE WHEN p_clear_stage THEN NULL ELSE COALESCE(p_stage, stage_id) END,
    verified_by = v_mem
  WHERE id = p_work_item;

  IF v_old_mat IS NOT NULL THEN PERFORM fn__rebuild_boq_group(v_type, v_old_stage, v_old_mat); END IF;
  PERFORM fn__rebuild_boq_group(
    v_type,
    (SELECT stage_id FROM type_work_items WHERE id = p_work_item),
    (SELECT material_id FROM type_work_items WHERE id = p_work_item));

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'update_work_item', 'type_work_items', p_work_item,
          jsonb_build_object('kind', p_kind, 'assembly_id', p_assembly, 'material_id', p_material,
                             'cleared_material', p_clear_material, 'cleared_assembly', p_clear_assembly,
                             'in_scope', p_in_scope, 'stage_id', p_stage, 'cleared_stage', p_clear_stage));
END $$;

-- ── guard at CONFIRM time (fn_confirm_boq_import_v2) ─────────────────────────
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
    PERFORM fn__assert_assembly_unit(v_assembly, v_unit);   -- THE guard

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
