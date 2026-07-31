-- Building money model (founder-approved, 2026-07-31): the RECIPE is a timeless
-- document; each BUILDING is a financial event judged against its own moment.
-- 1) building_budgets: the budget "photograph" taken when a building starts —
--    append-only, one per building; the recipe stays live, the building remembers.
-- 2) building_money: budget · spent · earned · forecast, computed live.
-- 3) building_finish_takeoff: materials still needed to FINISH a building
--    (remaining work → mixes → stock units), the focus-and-finish buy list.

CREATE TABLE building_budgets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  UUID NOT NULL UNIQUE REFERENCES buildings(id) ON DELETE RESTRICT,
  total        NUMERIC(16,2) NOT NULL,
  breakdown    JSONB,                       -- per work item: est + source at snapshot
  prices_as_of DATE NOT NULL DEFAULT CURRENT_DATE,
  taken_by     UUID REFERENCES memberships(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE building_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY building_budgets_select ON building_budgets FOR SELECT
  USING (EXISTS (SELECT 1 FROM buildings b WHERE b.id = building_budgets.building_id
                   AND b.org_id = current_org_id() AND has_project_access(b.project_id)));
GRANT SELECT ON building_budgets TO authenticated;

-- Take the photograph (idempotent: the first snapshot stands; re-calls return it).
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
    FROM work_item_cost WHERE building_type_id = v_type AND est_cost IS NOT NULL;

  INSERT INTO building_budgets (building_id, total, breakdown, taken_by)
  VALUES (p_building, v_total, v_break, v_mem) RETURNING id INTO v_id;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'snapshot_building_budget', 'building_budgets', v_id,
          jsonb_build_object('total', v_total));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_snapshot_building_budget(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_snapshot_building_budget(uuid) TO authenticated;

-- Money card: budget (photo) · spent (issued materials + approved expenses) ·
-- earned (work done × live cost) · remaining (work left at today's estimate).
CREATE VIEW building_money WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.project_id, b.org_id,
       bb.total AS budget, bb.prices_as_of AS budget_date,
       COALESCE(mat.spent, 0) + COALESCE(exp.spent, 0) AS spent,
       ev.earned, ev.remaining,
       COALESCE(mat.spent, 0) + COALESCE(exp.spent, 0) + COALESCE(ev.remaining, 0) AS forecast
FROM buildings b
LEFT JOIN building_budgets bb ON bb.building_id = b.id
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
GRANT SELECT ON building_money TO authenticated;

-- Focus-and-finish buy list: remaining work → materials (direct + via mixes,
-- waste/reuse/conversions applied) per building, with current project stock.
CREATE VIEW building_finish_takeoff WITH (security_invoker = true) AS
WITH rem AS (
  SELECT ev.building_id, wi.id AS work_item_id, wi.material_id, wi.assembly_id, wi.kind,
         wi.unit, GREATEST(ev.qty_planned - COALESCE(ev.qty_done, 0), 0) AS qty_left
  FROM building_work_ev ev JOIN type_work_items wi ON wi.id = ev.work_item_id
), needs AS (
  SELECT r.building_id, r.material_id,
         fn_convert_to_material_unit(r.material_id, r.qty_left, r.unit) AS qty
  FROM rem r WHERE r.kind = 'material_supply' AND r.material_id IS NOT NULL
  UNION ALL
  SELECT r.building_id, ac.material_id,
         fn_convert_to_material_unit(ac.material_id,
           r.qty_left * CASE WHEN ac.component_kind = 'reusable'
                             THEN ac.qty_per_unit / GREATEST(COALESCE(ac.reuse_count,1),1)
                             ELSE ac.qty_per_unit * ac.waste_factor END, ac.unit)
  FROM rem r JOIN assembly_components ac ON ac.assembly_id = r.assembly_id
  WHERE r.kind = 'composite'
)
SELECT n.building_id, b.project_id, n.material_id,
       SUM(n.qty) AS qty_needed,
       COALESCE(MAX(mb.balance), 0) AS in_store
FROM needs n
JOIN buildings b ON b.id = n.building_id
LEFT JOIN material_balances mb ON mb.project_id = b.project_id AND mb.material_id = n.material_id
WHERE n.qty IS NOT NULL AND n.qty > 0
GROUP BY n.building_id, b.project_id, n.material_id;
GRANT SELECT ON building_finish_takeoff TO authenticated;
