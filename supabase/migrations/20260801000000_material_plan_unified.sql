-- Unify "planned materials" on the true-cost take-off (founder pilot, 2026-08-01).
--
-- type_boq_items holds only DIRECTLY-supplied materials; type_material_takeoff is the
-- COMPLETE picture — direct supply PLUS materials derived from mixes/assemblies (cement
-- in concrete, etc.), with waste factors and unit conversion. So "planned material" =
-- the take-off, with a type_boq_items FALLBACK for (type,stage,material) pairs the
-- take-off doesn't cover (manually-built recipes that have no work items). This unifies
-- reorder advice, per-building variance, per-batch procurement, and the AC-9 overrun
-- check onto ONE complete source — without breaking manual recipes or existing tests
-- (their type_boq_items setup falls through the take-off and is picked up by the fallback).
--
-- Also splits the materials story by the RIGHT grain: the store is a project pool
-- (project level); variance is per BUILDING (a project average hides per-house overrun);
-- procurement is per BATCH. The old project-wide "usage vs plan" table is retired.

-- ── unified per-stage / per-type material plan (take-off + type_boq_items fallback) ──
CREATE OR REPLACE VIEW type_material_plan_stage WITH (security_invoker = true) AS
SELECT building_type_id, stage_id, material_id, SUM(qty) AS qty
FROM (
  SELECT building_type_id, stage_id, material_id, qty_required AS qty
  FROM type_material_takeoff
  UNION ALL
  SELECT tb.building_type_id, tb.stage_id, tb.material_id, tb.quantity AS qty
  FROM type_boq_items tb
  WHERE NOT EXISTS (
    SELECT 1 FROM type_material_takeoff tt
    WHERE tt.building_type_id = tb.building_type_id
      AND tt.stage_id IS NOT DISTINCT FROM tb.stage_id
      AND tt.material_id = tb.material_id)
) u
GROUP BY building_type_id, stage_id, material_id;
GRANT SELECT ON type_material_plan_stage TO authenticated;

CREATE OR REPLACE VIEW type_material_plan WITH (security_invoker = true) AS
SELECT building_type_id, material_id, SUM(qty) AS qty
FROM type_material_plan_stage
GROUP BY building_type_id, material_id;
GRANT SELECT ON type_material_plan TO authenticated;

-- ── per-building variance (take-off sourced; whole building + required-to-date) ──
-- planned_total = full recipe need; required = need for COMPLETED stages (the honest
-- overrun baseline); consumed = OUT to this building. Appended columns keep old readers.
CREATE OR REPLACE VIEW building_req_vs_actual WITH (security_invoker = on) AS
WITH plan AS (
  SELECT b.id AS building_id, tp.material_id, tp.qty AS planned_total
  FROM buildings b JOIN type_material_plan tp ON tp.building_type_id = b.building_type_id
),
req AS (
  SELECT b.id AS building_id, ps.material_id, SUM(ps.qty) AS required
  FROM buildings b
  JOIN building_stage_progress p ON p.building_id = b.id AND p.status = 'done'
  JOIN type_material_plan_stage ps ON ps.building_type_id = b.building_type_id AND ps.stage_id = p.stage_id
  GROUP BY b.id, ps.material_id
),
con AS (
  SELECT mt.building_id, mt.material_id, SUM(mt.quantity) AS consumed
  FROM material_transactions mt
  WHERE mt.type = 'OUT' AND mt.voided_at IS NULL AND mt.building_id IS NOT NULL
  GROUP BY mt.building_id, mt.material_id
)
SELECT COALESCE(plan.building_id, con.building_id) AS building_id,
       COALESCE(plan.material_id, con.material_id) AS material_id,
       COALESCE(req.required, 0) AS required,
       COALESCE(con.consumed, 0) AS consumed,
       COALESCE(con.consumed, 0) - COALESCE(req.required, 0) AS overrun,
       COALESCE(plan.planned_total, 0) AS planned_total,
       GREATEST(COALESCE(plan.planned_total, 0) - COALESCE(con.consumed, 0), 0) AS remaining
FROM plan
FULL OUTER JOIN con ON con.building_id = plan.building_id AND con.material_id = plan.material_id
LEFT JOIN req ON req.building_id = COALESCE(plan.building_id, con.building_id)
             AND req.material_id = COALESCE(plan.material_id, con.material_id);
GRANT SELECT ON building_req_vs_actual TO authenticated;

-- ── per-batch procurement plan (planned across the batch's live buildings) ──
CREATE OR REPLACE VIEW batch_material_plan WITH (security_invoker = true) AS
WITH plan AS (
  SELECT b.batch_id, b.project_id, tp.material_id, SUM(tp.qty) AS planned
  FROM buildings b JOIN type_material_plan tp ON tp.building_type_id = b.building_type_id
  WHERE b.batch_id IS NOT NULL AND b.archived_at IS NULL
  GROUP BY b.batch_id, b.project_id, tp.material_id
),
con AS (
  SELECT b.batch_id, mt.material_id, SUM(mt.quantity) AS consumed
  FROM material_transactions mt JOIN buildings b ON b.id = mt.building_id
  WHERE mt.type = 'OUT' AND mt.voided_at IS NULL AND b.batch_id IS NOT NULL AND b.archived_at IS NULL
  GROUP BY b.batch_id, mt.material_id
)
SELECT plan.batch_id, plan.project_id, plan.material_id,
       plan.planned,
       COALESCE(con.consumed, 0) AS consumed,
       GREATEST(plan.planned - COALESCE(con.consumed, 0), 0) AS remaining,
       COALESCE((SELECT mb.balance FROM material_balances mb
                 WHERE mb.project_id = plan.project_id AND mb.material_id = plan.material_id), 0) AS in_stock
FROM plan
LEFT JOIN con ON con.batch_id = plan.batch_id AND con.material_id = plan.material_id;
GRANT SELECT ON batch_material_plan TO authenticated;

-- ── reorder advice → take-off sourced, live buildings only ──
CREATE OR REPLACE FUNCTION fn_reorder_advice(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; result jsonb;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  IF fn__membership_in(v_org) IS NULL THEN
    RAISE EXCEPTION 'not a member of the project''s org' USING errcode = '42501'; END IF;

  WITH req AS (
    SELECT tp.material_id, SUM(tp.qty) AS required
    FROM buildings b JOIN type_material_plan tp ON tp.building_type_id = b.building_type_id
    WHERE b.project_id = p_project AND b.archived_at IS NULL GROUP BY tp.material_id
  ),
  con AS (
    SELECT mt.material_id, SUM(mt.quantity) AS consumed
    FROM material_transactions mt JOIN buildings b ON b.id = mt.building_id
    WHERE b.project_id = p_project AND b.archived_at IS NULL AND mt.type = 'OUT' AND mt.voided_at IS NULL
    GROUP BY mt.material_id
  ),
  stock AS (
    SELECT material_id, balance FROM material_balances WHERE project_id = p_project
  )
  SELECT jsonb_agg(jsonb_build_object(
           'material_id', m.material_id,
           'material_name', mc.name,
           'required', COALESCE(req.required,0),
           'consumed', COALESCE(con.consumed,0),
           'in_stock', COALESCE(stock.balance,0),
           'remaining', GREATEST(COALESCE(req.required,0) - COALESCE(con.consumed,0), 0),
           'order_qty', GREATEST(COALESCE(req.required,0) - COALESCE(con.consumed,0) - COALESCE(stock.balance,0), 0)
         ) ORDER BY mc.name)
    INTO result
  FROM (SELECT material_id FROM req UNION SELECT material_id FROM con) m
  LEFT JOIN req  ON req.material_id  = m.material_id
  LEFT JOIN con  ON con.material_id  = m.material_id
  LEFT JOIN stock ON stock.material_id = m.material_id
  JOIN materials_catalog mc ON mc.id = m.material_id;

  RETURN COALESCE(result, '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION fn_reorder_advice(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_reorder_advice(uuid) TO authenticated;

-- ── fn_complete_stage: AC-9 overrun check now on the unified plan (per stage) ──
CREATE OR REPLACE FUNCTION fn_complete_stage(p_building uuid, p_stage uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_project uuid; v_type uuid; v_mem uuid; v_next uuid; rec RECORD;
BEGIN
  SELECT b.org_id, b.project_id, b.building_type_id INTO v_org, v_project, v_type
  FROM buildings b WHERE b.id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  v_mem := fn_require_org_manager(v_org);

  IF NOT EXISTS (SELECT 1 FROM type_stages WHERE id = p_stage AND building_type_id = v_type) THEN
    RAISE EXCEPTION 'stage % is not in this building''s type', p_stage;
  END IF;

  UPDATE building_stage_progress
     SET status = 'done', completed_at = NOW(), approved_by = v_mem, started_at = COALESCE(started_at, NOW())
   WHERE building_id = p_building AND stage_id = p_stage;

  SELECT ts.id INTO v_next
  FROM type_stages ts
  JOIN building_stage_progress p ON p.stage_id = ts.id AND p.building_id = p_building
  WHERE ts.building_type_id = v_type AND p.status <> 'done'
  ORDER BY ts.sequence LIMIT 1;

  IF v_next IS NULL THEN
    UPDATE buildings SET current_stage_id = NULL, status = 'done' WHERE id = p_building;
  ELSE
    UPDATE building_stage_progress SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
     WHERE building_id = p_building AND stage_id = v_next;
    UPDATE buildings SET current_stage_id = v_next, status = 'in_progress' WHERE id = p_building;
  END IF;

  -- AC-9: overrun check for THIS stage (used > required), flagged at completion.
  -- Required now = the unified take-off plan for the stage (complete: mixes included).
  FOR rec IN
    SELECT ps.material_id, ps.qty AS required,
           COALESCE((SELECT SUM(mt.quantity) FROM material_transactions mt
                      WHERE mt.type = 'OUT' AND mt.voided_at IS NULL
                        AND mt.building_id = p_building AND mt.stage_id = p_stage
                        AND mt.material_id = ps.material_id), 0) AS consumed
    FROM type_material_plan_stage ps WHERE ps.building_type_id = v_type AND ps.stage_id = p_stage
  LOOP
    IF rec.consumed > rec.required THEN
      INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
      VALUES (v_org, auth.uid(), 'stage_overrun', 'buildings', p_building,
              jsonb_build_object('stage', p_stage, 'material', rec.material_id,
                                 'required', rec.required, 'consumed', rec.consumed,
                                 'overrun', rec.consumed - rec.required));
    END IF;
  END LOOP;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'complete_stage', 'buildings', p_building,
          jsonb_build_object('stage', p_stage, 'next_stage', v_next));
  RETURN v_next;
END $$;
REVOKE EXECUTE ON FUNCTION fn_complete_stage(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_complete_stage(uuid, uuid) TO authenticated;
