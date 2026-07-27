-- M5 · C — Requirement vs actual (§10, F-BOARD-5). Closes the M2 board's "consumed vs
-- required" seam: required = recipe qty for a building's COMPLETED stages; consumed =
-- material OUT tagged to that building. Overrun = consumed − required.

CREATE OR REPLACE VIEW building_req_vs_actual WITH (security_invoker = on) AS
WITH req AS (
  SELECT b.id AS building_id, bi.material_id, SUM(bi.quantity) AS required
  FROM buildings b
  JOIN building_stage_progress p ON p.building_id = b.id AND p.status = 'done'
  JOIN type_boq_items bi ON bi.building_type_id = b.building_type_id AND bi.stage_id = p.stage_id
  GROUP BY b.id, bi.material_id
),
con AS (
  SELECT mt.building_id, mt.material_id, SUM(mt.quantity) AS consumed
  FROM material_transactions mt
  WHERE mt.type = 'OUT' AND mt.voided_at IS NULL AND mt.building_id IS NOT NULL
  GROUP BY mt.building_id, mt.material_id
)
SELECT COALESCE(req.building_id, con.building_id) AS building_id,
       COALESCE(req.material_id, con.material_id) AS material_id,
       COALESCE(req.required, 0) AS required,
       COALESCE(con.consumed, 0) AS consumed,
       COALESCE(con.consumed, 0) - COALESCE(req.required, 0) AS overrun
FROM req FULL OUTER JOIN con ON con.building_id = req.building_id AND con.material_id = req.material_id;
GRANT SELECT ON building_req_vs_actual TO authenticated;

-- Extend fn_complete_stage (M2) to run the requirement-vs-actual check AT COMPLETION and
-- flag any material where used > required for that stage — "at the pour, not weeks later"
-- (§10.2 / AC-9). The flag is an audit_log entry; the live view above shows it on the board.
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
  FOR rec IN
    SELECT bi.material_id, bi.quantity AS required,
           COALESCE((SELECT SUM(mt.quantity) FROM material_transactions mt
                      WHERE mt.type = 'OUT' AND mt.voided_at IS NULL
                        AND mt.building_id = p_building AND mt.stage_id = p_stage
                        AND mt.material_id = bi.material_id), 0) AS consumed
    FROM type_boq_items bi WHERE bi.building_type_id = v_type AND bi.stage_id = p_stage
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
