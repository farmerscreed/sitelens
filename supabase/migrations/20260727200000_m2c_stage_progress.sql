-- M2 · C — Stage completion (F-BOARD-4). Marks a building's stage done and advances
-- it to the next stage. Manager-gated (a PM approves); mobile field capture in M4 will
-- wrap this same function. building_stage_progress has no client write policy (Rule 1).

CREATE OR REPLACE FUNCTION fn_complete_stage(p_building uuid, p_stage uuid)
RETURNS uuid  -- returns the new current_stage_id (NULL when the building is fully done)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_project uuid; v_type uuid; v_mem uuid; v_next uuid;
BEGIN
  SELECT b.org_id, b.project_id, b.building_type_id
    INTO v_org, v_project, v_type
  FROM buildings b WHERE b.id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  v_mem := fn_require_org_manager(v_org);

  IF NOT EXISTS (SELECT 1 FROM type_stages WHERE id = p_stage AND building_type_id = v_type) THEN
    RAISE EXCEPTION 'stage % is not in this building''s type', p_stage;
  END IF;

  -- Mark the stage done (progress rows were seeded at stamp time).
  UPDATE building_stage_progress
     SET status = 'done', completed_at = NOW(), approved_by = v_mem,
         started_at = COALESCE(started_at, NOW())
   WHERE building_id = p_building AND stage_id = p_stage;

  -- Next stage = lowest-sequence stage of this building that is not yet done.
  SELECT ts.id INTO v_next
  FROM type_stages ts
  JOIN building_stage_progress p ON p.stage_id = ts.id AND p.building_id = p_building
  WHERE ts.building_type_id = v_type AND p.status <> 'done'
  ORDER BY ts.sequence
  LIMIT 1;

  IF v_next IS NULL THEN
    -- All stages done.
    UPDATE buildings SET current_stage_id = NULL, status = 'done' WHERE id = p_building;
  ELSE
    UPDATE building_stage_progress SET status = 'in_progress', started_at = COALESCE(started_at, NOW())
     WHERE building_id = p_building AND stage_id = v_next;
    UPDATE buildings SET current_stage_id = v_next, status = 'in_progress' WHERE id = p_building;
  END IF;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'complete_stage', 'buildings', p_building,
          jsonb_build_object('stage', p_stage, 'next_stage', v_next));
  RETURN v_next;
END $$;
REVOKE EXECUTE ON FUNCTION fn_complete_stage(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_complete_stage(uuid, uuid) TO authenticated;
