-- CONTRACT SCOPE (founder-approved, 2026-07-31): a semi-finished bill is 100%
-- when its CONTRACT is 100%. Every work item is in-contract or excluded
-- (by others); the bill itself sets the default (priced = in, unpriced = out).
-- Buildings inherit the recipe's scope; pulling an excluded item into one
-- building is a dated, audited VARIATION that extends that building's budget —
-- never a silent flag-flip. Ease of use: defaults derived, one review, done.

ALTER TABLE type_work_items ADD COLUMN in_scope BOOLEAN NOT NULL DEFAULT true;
-- Bill-derived default for everything already imported.
UPDATE type_work_items SET in_scope = is_priced;

-- work_item_cost must expose the new column (wi.* changed shape → drop/recreate).
DROP VIEW IF EXISTS work_item_cost CASCADE;
CREATE VIEW work_item_cost WITH (security_invoker = true) AS
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

-- fn_update_work_item gains p_in_scope (7 args; 6-arg overload dropped).
DROP FUNCTION IF EXISTS fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean);
CREATE FUNCTION fn_update_work_item(
  p_work_item uuid, p_kind work_item_kind DEFAULT NULL,
  p_assembly uuid DEFAULT NULL, p_material uuid DEFAULT NULL,
  p_clear_material boolean DEFAULT false, p_clear_assembly boolean DEFAULT false,
  p_in_scope boolean DEFAULT NULL)
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
    in_scope    = COALESCE(p_in_scope, in_scope),
    verified_by = v_mem
  WHERE id = p_work_item;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'update_work_item', 'type_work_items', p_work_item,
          jsonb_build_object('kind', p_kind, 'assembly_id', p_assembly, 'material_id', p_material,
                             'cleared_material', p_clear_material, 'cleared_assembly', p_clear_assembly,
                             'in_scope', p_in_scope));
END $$;
REVOKE EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean, boolean) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_update_work_item(uuid, work_item_kind, uuid, uuid, boolean, boolean, boolean) TO authenticated;

-- New imports: scope defaults from the bill at confirm time.
-- (fn_confirm_boq_import_v2 writes is_priced already; mirror it into in_scope.)
CREATE OR REPLACE FUNCTION fn__sync_workitem_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN NEW.in_scope := NEW.is_priced; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_workitem_scope_default BEFORE INSERT ON type_work_items
  FOR EACH ROW EXECUTE FUNCTION fn__sync_workitem_scope();

-- ── Variations: pull an excluded item into ONE building, dated + priced ──────
CREATE TABLE building_variations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     UUID NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  work_item_id    UUID NOT NULL REFERENCES type_work_items(id) ON DELETE RESTRICT,
  est_at_addition NUMERIC(16,2),          -- est_cost captured when added
  note            TEXT,
  added_by        UUID REFERENCES memberships(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (building_id, work_item_id)
);
ALTER TABLE building_variations ENABLE ROW LEVEL SECURITY;
CREATE POLICY building_variations_select ON building_variations FOR SELECT
  USING (EXISTS (SELECT 1 FROM buildings b WHERE b.id = building_variations.building_id
                   AND b.org_id = current_org_id() AND has_project_access(b.project_id)));
GRANT SELECT ON building_variations TO authenticated;

CREATE OR REPLACE FUNCTION fn_add_building_variation(
  p_building uuid, p_work_item uuid, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_type uuid; v_mem uuid; v_id uuid; v_est numeric;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM buildings WHERE id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  v_mem := fn_require_org_manager(v_org);
  IF NOT EXISTS (SELECT 1 FROM type_work_items
                 WHERE id = p_work_item AND building_type_id = v_type) THEN
    RAISE EXCEPTION 'work item % is not in building''s type', p_work_item USING errcode = '42501';
  END IF;
  SELECT est_cost INTO v_est FROM work_item_cost WHERE id = p_work_item;
  INSERT INTO building_variations (building_id, work_item_id, est_at_addition, note, added_by)
  VALUES (p_building, p_work_item, v_est, p_note, v_mem)
  ON CONFLICT (building_id, work_item_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM building_variations
     WHERE building_id = p_building AND work_item_id = p_work_item;
  END IF;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'add_building_variation', 'building_variations', v_id,
          jsonb_build_object('work_item_id', p_work_item, 'est_at_addition', v_est, 'note', p_note));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_add_building_variation(uuid, uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_add_building_variation(uuid, uuid, text) TO authenticated;

-- ── Scope-aware money: budget photo = in-scope only; variations extend it ────
CREATE OR REPLACE FUNCTION fn_snapshot_building_budget(p_building uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_type uuid; v_mem uuid; v_id uuid; v_total numeric; v_break jsonb;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM buildings WHERE id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  v_mem := fn_require_org_manager(v_org);
  SELECT id INTO v_id FROM building_budgets WHERE building_id = p_building;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT COALESCE(SUM(est_cost), 0),
         jsonb_agg(jsonb_build_object('work_item_id', id, 'stage_id', stage_id,
                   'est_cost', est_cost, 'est_source', est_source))
    INTO v_total, v_break
    FROM work_item_cost
   WHERE building_type_id = v_type AND est_cost IS NOT NULL AND in_scope;
  INSERT INTO building_budgets (building_id, total, breakdown, taken_by)
  VALUES (p_building, v_total, v_break, v_mem) RETURNING id INTO v_id;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'snapshot_building_budget', 'building_budgets', v_id,
          jsonb_build_object('total', v_total));
  RETURN v_id;
END $$;

-- EV / finish list: contract items always; excluded items only via a variation.
CREATE OR REPLACE VIEW building_work_ev WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.project_id, wi.id AS work_item_id, wi.stage_id,
       wi.element_name, wi.description, wi.kind, wi.quantity AS qty_planned, wi.unit,
       act.qty_done,
       fn_work_item_unit_cost(wi.id)                          AS unit_cost_live,
       wi.quantity   * fn_work_item_unit_cost(wi.id)          AS planned_value,
       act.qty_done  * fn_work_item_unit_cost(wi.id)          AS earned_value,
       wi.quantity   * wi.boq_rate                            AS boq_amount
FROM buildings b
JOIN type_work_items wi ON wi.building_type_id = b.building_type_id
  AND (wi.in_scope OR EXISTS (SELECT 1 FROM building_variations v
                              WHERE v.building_id = b.id AND v.work_item_id = wi.id))
LEFT JOIN LATERAL (
  SELECT a.qty_done FROM building_work_actuals a
   WHERE a.building_id = b.id AND a.work_item_id = wi.id
   ORDER BY a.as_of DESC, a.created_at DESC LIMIT 1
) act ON true;

-- Money card: budget = photo + variations. (New column mid-view → drop/recreate.)
DROP VIEW IF EXISTS building_money;
CREATE VIEW building_money WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.project_id, b.org_id,
       CASE WHEN bb.total IS NULL THEN NULL
            ELSE bb.total + COALESCE(vr.added, 0) END AS budget,
       bb.prices_as_of AS budget_date,
       COALESCE(vr.added, 0) AS variations_total,
       COALESCE(mat.spent, 0) + COALESCE(exp.spent, 0) AS spent,
       ev.earned, ev.remaining,
       COALESCE(mat.spent, 0) + COALESCE(exp.spent, 0) + COALESCE(ev.remaining, 0) AS forecast
FROM buildings b
LEFT JOIN building_budgets bb ON bb.building_id = b.id
LEFT JOIN LATERAL (
  SELECT SUM(v.est_at_addition) AS added FROM building_variations v WHERE v.building_id = b.id
) vr ON true
LEFT JOIN LATERAL (
  SELECT SUM(mt.quantity * COALESCE(mt.unit_price, current_price(b.org_id, mt.material_id))) AS spent
  FROM material_transactions mt
  WHERE mt.building_id = b.id AND mt.type = 'OUT' AND mt.voided_at IS NULL
) mat ON true
LEFT JOIN LATERAL (
  SELECT SUM(e.amount) AS spent FROM expenses e
  WHERE e.building_id = b.id AND e.status = 'approved' AND e.voided_at IS NULL
) exp ON true
LEFT JOIN LATERAL (
  SELECT SUM(ev.earned_value) AS earned,
         SUM(GREATEST(ev.qty_planned - COALESCE(ev.qty_done, 0), 0)
             * COALESCE(ev.unit_cost_live, ev.boq_amount / NULLIF(ev.qty_planned, 0))) AS remaining
  FROM building_work_ev ev WHERE ev.building_id = b.id
) ev ON true;
