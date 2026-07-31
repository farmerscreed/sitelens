-- fn_update_work_item could SET material/assembly but never CLEAR them (COALESCE
-- semantics) — needed to detach a wrongly-linked material (e.g. Cement matched
-- onto a PoP line) and for the agreed-rate path (labour kind + rate mix, material
-- cleared). Recreated with explicit clear flags; old 4-arg overload dropped.
DROP FUNCTION IF EXISTS fn_update_work_item(uuid, work_item_kind, uuid, uuid);
CREATE FUNCTION fn_update_work_item(
  p_work_item uuid, p_kind work_item_kind DEFAULT NULL,
  p_assembly uuid DEFAULT NULL, p_material uuid DEFAULT NULL,
  p_clear_material boolean DEFAULT false, p_clear_assembly boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid;
BEGIN
  SELECT bt.org_id INTO v_org FROM type_work_items wi
    JOIN building_types bt ON bt.id = wi.building_type_id WHERE wi.id = p_work_item;
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
  UPDATE type_work_items SET
    kind        = COALESCE(p_kind, kind),
    assembly_id = CASE WHEN p_clear_assembly THEN NULL ELSE COALESCE(p_assembly, assembly_id) END,
    material_id = CASE WHEN p_clear_material THEN NULL ELSE COALESCE(p_material, material_id) END,
    verified_by = v_mem
  WHERE id = p_work_item;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'update_work_item', 'type_work_items', p_work_item,
          jsonb_build_object('kind', p_kind, 'assembly_id', p_assembly, 'material_id', p_material,
                             'cleared_material', p_clear_material, 'cleared_assembly', p_clear_assembly));
END $$;
REVOKE EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean) TO authenticated;
