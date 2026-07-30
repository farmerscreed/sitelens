-- Blended estimate + work-item editing (founder items 1 & 2, 2026-07-30).
-- 1) fn_update_work_item: re-kind a misclassified item, attach an assembly or
--    material — the write path behind assembly proposals and bulk re-kind.
-- 2) work_item_cost gains est_cost/est_source: the live build-up where one
--    exists, the QS's own BOQ rate as FALLBACK where it doesn't — so the
--    estimate is complete from day one and converges to the true build-up.
--    Rule 4 intact: nothing stored, the fallback is labelled, never silent.

CREATE OR REPLACE FUNCTION fn_update_work_item(
  p_work_item uuid, p_kind work_item_kind DEFAULT NULL,
  p_assembly uuid DEFAULT NULL, p_material uuid DEFAULT NULL)
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
    assembly_id = COALESCE(p_assembly, assembly_id),
    material_id = COALESCE(p_material, material_id),
    verified_by = v_mem
  WHERE id = p_work_item;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'update_work_item', 'type_work_items', p_work_item,
          jsonb_build_object('kind', p_kind, 'assembly_id', p_assembly, 'material_id', p_material));
END $$;
REVOKE EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid) TO authenticated;

-- est_cost: live build-up first, BOQ rate fallback, labelled by est_source.
CREATE OR REPLACE VIEW work_item_cost WITH (security_invoker = true) AS
SELECT wi.*,
       fn_work_item_unit_cost(wi.id)                        AS unit_cost_live,
       wi.quantity * fn_work_item_unit_cost(wi.id)          AS cost_live,
       wi.quantity * wi.boq_rate                            AS boq_amount,
       COALESCE(wi.quantity * fn_work_item_unit_cost(wi.id),
                wi.quantity * wi.boq_rate)                  AS est_cost,
       CASE WHEN fn_work_item_unit_cost(wi.id) IS NOT NULL THEN 'build_up'
            WHEN wi.boq_rate IS NOT NULL AND wi.quantity IS NOT NULL THEN 'boq_rate'
       END                                                  AS est_source
FROM type_work_items wi;
GRANT SELECT ON work_item_cost TO authenticated;
