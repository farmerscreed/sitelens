-- Delete & edit paths (founder request, 2026-08-05): staged bills, work items,
-- recipes and buildings become deletable — through SECURITY DEFINER fns with
-- guards, never raw client deletes (Rule 1).
--
-- THE LINE THAT DOES NOT MOVE: financial records (expenses, material
-- transactions, payments, sales) stay append-only — void, never delete/edit.
-- Deleting here is for PLANNING data (staging rows, work items, recipes) and
-- for buildings with NO history. Anything with history refuses with a clear
-- message pointing at archive/void instead.

-- ── internal: rebuild one classic-recipe group after supply work items change ─
-- type_boq_items is the summed projection of material_supply work items per
-- (stage, material); manual rows in untouched groups are never affected.
-- NULL material → no-op (lets callers invoke it blindly after an edit).
CREATE OR REPLACE FUNCTION fn__rebuild_boq_group(p_type uuid, p_stage uuid, p_material uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_sum numeric; v_unit text;
BEGIN
  IF p_material IS NULL THEN RETURN; END IF;
  SELECT SUM(quantity), MAX(unit) INTO v_sum, v_unit
    FROM type_work_items
   WHERE building_type_id = p_type AND kind = 'material_supply'
     AND material_id = p_material AND stage_id IS NOT DISTINCT FROM p_stage
     AND quantity IS NOT NULL;
  IF COALESCE(v_sum, 0) = 0 THEN
    DELETE FROM type_boq_items
     WHERE building_type_id = p_type AND material_id = p_material
       AND stage_id IS NOT DISTINCT FROM p_stage;
  ELSE
    -- UPSERT, not update: a supply line MOVED into a stage with no row yet must
    -- create that row, or its contribution silently vanishes (uq_type_boq_item
    -- is NULLS NOT DISTINCT, so the NULL-stage group upserts too).
    INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit)
    VALUES (p_type, p_stage, p_material, v_sum, v_unit)
    ON CONFLICT (building_type_id, stage_id, material_id)
      DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit;
  END IF;
END $$;

-- ── delete an extracted bill (boq import) ────────────────────────────────────
-- Staging data is proposals — freely deletable by a manager. If the import was
-- already CONFIRMED, its work items only go when the caller explicitly says so;
-- the classic recipe is recomputed for every touched (stage, material) group.
CREATE OR REPLACE FUNCTION fn_delete_boq_import(p_import uuid, p_delete_work_items boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_type uuid; v_wi int; grp record; v_rows int;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  SELECT COUNT(*) INTO v_wi
    FROM type_work_items wi JOIN boq_import_rows br ON br.id = wi.source_row_id
   WHERE br.import_id = p_import;
  IF v_wi > 0 AND NOT p_delete_work_items THEN
    RAISE EXCEPTION '% confirmed work item(s) came from this import — deleting it removes them from the recipe too; confirm the cascade', v_wi;
  END IF;

  IF v_wi > 0 THEN
    DROP TABLE IF EXISTS _touched_groups;
    CREATE TEMP TABLE _touched_groups AS
      SELECT DISTINCT wi.building_type_id AS t, wi.stage_id AS s, wi.material_id AS m
        FROM type_work_items wi JOIN boq_import_rows br ON br.id = wi.source_row_id
       WHERE br.import_id = p_import AND wi.kind = 'material_supply' AND wi.material_id IS NOT NULL;
    DELETE FROM type_work_items wi USING boq_import_rows br
     WHERE br.id = wi.source_row_id AND br.import_id = p_import;
    FOR grp IN SELECT * FROM _touched_groups LOOP
      PERFORM fn__rebuild_boq_group(grp.t, grp.s, grp.m);
    END LOOP;
    DROP TABLE _touched_groups;
  END IF;

  DELETE FROM boq_import_rows WHERE import_id = p_import;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  DELETE FROM boq_imports WHERE id = p_import;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'delete_boq_import', 'boq_imports', p_import,
          jsonb_build_object('rows', v_rows, 'work_items', v_wi));
  RETURN jsonb_build_object('rows', v_rows, 'work_items', v_wi);
END $$;
REVOKE EXECUTE ON FUNCTION fn_delete_boq_import(uuid, boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_delete_boq_import(uuid, boolean) TO authenticated;

-- ── delete one work item (recipe line) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_delete_work_item(p_work_item uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_type uuid; v_stage uuid; v_mat uuid; v_kind work_item_kind;
BEGIN
  SELECT bt.org_id, wi.building_type_id, wi.stage_id, wi.material_id, wi.kind
    INTO v_org, v_type, v_stage, v_mat, v_kind
    FROM type_work_items wi JOIN building_types bt ON bt.id = wi.building_type_id
   WHERE wi.id = p_work_item;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown work item %', p_work_item; END IF;
  PERFORM fn_require_org_manager(v_org);

  DELETE FROM type_work_items WHERE id = p_work_item;
  IF v_kind = 'material_supply' AND v_mat IS NOT NULL THEN
    PERFORM fn__rebuild_boq_group(v_type, v_stage, v_mat);
  END IF;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'delete_work_item', 'type_work_items', p_work_item, NULL);
END $$;
REVOKE EXECUTE ON FUNCTION fn_delete_work_item(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_delete_work_item(uuid) TO authenticated;

-- ── edit: work items gain a movable stage ────────────────────────────────────
-- (9 args; the 7-arg overload is dropped.) Moving a supply line's stage also
-- moves its classic-recipe contribution — both groups are rebuilt.
DROP FUNCTION IF EXISTS fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean, boolean);
CREATE FUNCTION fn_update_work_item(
  p_work_item uuid, p_kind work_item_kind DEFAULT NULL,
  p_assembly uuid DEFAULT NULL, p_material uuid DEFAULT NULL,
  p_clear_material boolean DEFAULT false, p_clear_assembly boolean DEFAULT false,
  p_in_scope boolean DEFAULT NULL,
  p_stage uuid DEFAULT NULL, p_clear_stage boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid; v_type uuid; v_old_stage uuid; v_old_mat uuid; v_kind work_item_kind;
BEGIN
  SELECT bt.org_id, wi.building_type_id, wi.stage_id, wi.material_id, wi.kind
    INTO v_org, v_type, v_old_stage, v_old_mat, v_kind
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

  UPDATE type_work_items SET
    kind        = COALESCE(p_kind, kind),
    assembly_id = CASE WHEN p_clear_assembly THEN NULL ELSE COALESCE(p_assembly, assembly_id) END,
    material_id = CASE WHEN p_clear_material THEN NULL ELSE COALESCE(p_material, material_id) END,
    in_scope    = COALESCE(p_in_scope, in_scope),
    stage_id    = CASE WHEN p_clear_stage THEN NULL ELSE COALESCE(p_stage, stage_id) END,
    verified_by = v_mem
  WHERE id = p_work_item;

  -- A moved/re-kinded supply line changes its summed projection in BOTH groups.
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
REVOKE EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean, boolean, uuid, boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean, boolean, uuid, boolean) TO authenticated;

-- ── delete a building (ADMIN; planning-only buildings) ───────────────────────
-- History = money, reports, photos, work-done, sales, portal links. Any of it
-- present → refuse and point at archive. A clean building deletes fully and
-- frees its code.
CREATE OR REPLACE FUNCTION fn_delete_building(p_building uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_code text; blockers text := '';
BEGIN
  SELECT org_id, code INTO v_org, v_code FROM buildings WHERE id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  PERFORM fn_require_org_admin(v_org);

  IF EXISTS (SELECT 1 FROM material_transactions WHERE building_id = p_building) THEN blockers := blockers || 'material movements, '; END IF;
  IF EXISTS (SELECT 1 FROM expenses            WHERE building_id = p_building) THEN blockers := blockers || 'expenses, '; END IF;
  IF EXISTS (SELECT 1 FROM daily_reports       WHERE building_id = p_building) THEN blockers := blockers || 'reports, '; END IF;
  IF EXISTS (SELECT 1 FROM media               WHERE building_id = p_building) THEN blockers := blockers || 'photos, '; END IF;
  IF EXISTS (SELECT 1 FROM building_work_actuals WHERE building_id = p_building) THEN blockers := blockers || 'work-done logs, '; END IF;
  IF EXISTS (SELECT 1 FROM sales               WHERE building_id = p_building) THEN blockers := blockers || 'sales, '; END IF;
  IF EXISTS (SELECT 1 FROM portal_links        WHERE building_id = p_building) THEN blockers := blockers || 'portal links, '; END IF;
  IF blockers <> '' THEN
    RAISE EXCEPTION 'building % has history (%) — archive it instead; history is never deleted',
      v_code, left(blockers, length(blockers) - 2);
  END IF;

  DELETE FROM building_stage_progress WHERE building_id = p_building;
  DELETE FROM building_variations     WHERE building_id = p_building;
  DELETE FROM building_budgets        WHERE building_id = p_building;
  DELETE FROM buildings               WHERE id = p_building;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'delete_building', 'buildings', p_building,
          jsonb_build_object('code', v_code));
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION 'building % is still referenced by other records — archive it instead', v_code;
END $$;
REVOKE EXECUTE ON FUNCTION fn_delete_building(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_delete_building(uuid) TO authenticated;

-- ── delete a recipe (ADMIN; nothing may be built from it) ────────────────────
-- Cascade wipes its stages, work items, classic recipe, check values and its
-- imports (staging). Child versions are unlinked, never deleted.
CREATE OR REPLACE FUNCTION fn_delete_building_type(p_type uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_name text; n int;
BEGIN
  SELECT org_id, name INTO v_org, v_name FROM building_types WHERE id = p_type;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  PERFORM fn_require_org_admin(v_org);

  SELECT COUNT(*) INTO n FROM buildings WHERE building_type_id = p_type;
  IF n > 0 THEN
    RAISE EXCEPTION '% building(s) are stamped from "%" — delete or archive those first (or archive the recipe)', n, v_name;
  END IF;
  SELECT COUNT(*) INTO n FROM plan_lines WHERE building_type_id = p_type;
  IF n > 0 THEN
    RAISE EXCEPTION '"%" is used by % planner line(s) — remove it from those plans first', v_name, n;
  END IF;

  UPDATE building_types SET parent_version_id = NULL WHERE parent_version_id = p_type;
  DELETE FROM boq_import_rows br USING boq_imports bi
   WHERE bi.id = br.import_id AND bi.building_type_id = p_type;
  DELETE FROM boq_imports WHERE building_type_id = p_type;
  DELETE FROM building_types WHERE id = p_type;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'delete_building_type', 'building_types', p_type,
          jsonb_build_object('name', v_name));
EXCEPTION WHEN foreign_key_violation THEN
  RAISE EXCEPTION '"%" is still referenced by other records — archive it instead', v_name;
END $$;
REVOKE EXECUTE ON FUNCTION fn_delete_building_type(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_delete_building_type(uuid) TO authenticated;
