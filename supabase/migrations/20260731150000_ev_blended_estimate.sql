-- Earned-value blended estimate (founder pilot finding, 2026-07-31).
--
-- The budget photo (fn_snapshot_building_budget) and the money card's "remaining"
-- both value work at the BLENDED estimate: the live build-up where one exists,
-- the QS's own BOQ rate as a labelled fallback otherwise — the same est_cost the
-- recipe headline uses. But building_work_ev computed planned_value/earned_value
-- from fn_work_item_unit_cost ALONE (no fallback), so QS-rate lines contributed
-- nothing. Result: one building showed a blended budget (e.g. ₦288.8M) but an
-- own-price-only planned value (₦140.7M) — internally contradictory, and progress
-- measured against less than the whole job.
--
-- Fix: blend planned_value/earned_value/unit_cost_live with the boq_rate fallback,
-- identical to work_item_cost.est_cost and to building_money.remaining, and expose
-- est_source so the QS-rate fallback stays visible, never silent (Rule 4).
-- building_money is unaffected (its "remaining" already COALESCE'd to the rate;
-- its "earned" now correctly counts QS-rate lines with logged work).
-- CREATE OR REPLACE + appended est_source column keeps building_money valid.

CREATE OR REPLACE VIEW building_work_ev WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.project_id, wi.id AS work_item_id, wi.stage_id,
       wi.element_name, wi.description, wi.kind, wi.quantity AS qty_planned, wi.unit,
       act.qty_done,
       COALESCE(fn_work_item_unit_cost(wi.id), wi.boq_rate)                  AS unit_cost_live,
       wi.quantity   * COALESCE(fn_work_item_unit_cost(wi.id), wi.boq_rate)  AS planned_value,
       act.qty_done  * COALESCE(fn_work_item_unit_cost(wi.id), wi.boq_rate)  AS earned_value,
       wi.quantity   * wi.boq_rate                                          AS boq_amount,
       CASE WHEN fn_work_item_unit_cost(wi.id) IS NOT NULL THEN 'build_up'
            WHEN wi.boq_rate IS NOT NULL AND wi.quantity IS NOT NULL THEN 'boq_rate'
       END                                                                  AS est_source
FROM buildings b
JOIN type_work_items wi ON wi.building_type_id = b.building_type_id
  AND (wi.in_scope OR EXISTS (SELECT 1 FROM building_variations v
                              WHERE v.building_id = b.id AND v.work_item_id = wi.id))
LEFT JOIN LATERAL (
  SELECT a.qty_done FROM building_work_actuals a
   WHERE a.building_id = b.id AND a.work_item_id = wi.id
   ORDER BY a.as_of DESC, a.created_at DESC LIMIT 1
) act ON true;
