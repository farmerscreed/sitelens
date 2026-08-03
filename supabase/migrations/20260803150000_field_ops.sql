-- Field ops (DECISIONS #65) — Phase A of the mobile field app. The PRD (§4) gives
-- the Site Engineer "mark building stages complete" and "log materials in/out";
-- materials already gate on any active member (fn_log_material_txn), but stage
-- completion was manager-only since M2. Founder decision (2026-08-03): a field
-- tick lands on the board INSTANTLY, labelled "from field", and a manager can
-- revert it. So:
--   • building_stage_progress records WHO completed and FROM WHERE (Rule 2 —
--     every fact has a source): completed_by + completed_source ('web'|'field');
--     approved_by is now only set when a manager completes (a field tick leaves
--     it NULL — visibly unconfirmed, never silently equal to a manager tick).
--   • fn_complete_stage now admits the engineer role and takes p_source
--     (old 2-arg signature dropped — PostgREST ambiguity, same move as portal_v2;
--     existing 2-arg calls keep working via the DEFAULT).
--   • fn_reopen_stage (manager-only) is the revert: puts a stage back to
--     in_progress and rewinds the building's current stage.
-- No money path is touched; engineers still cannot write a price, expense,
-- budget, or BOQ row.

ALTER TABLE building_stage_progress
  ADD COLUMN IF NOT EXISTS completed_by     UUID REFERENCES memberships(id),
  ADD COLUMN IF NOT EXISTS completed_source TEXT CHECK (completed_source IN ('web','field'));

DROP FUNCTION IF EXISTS fn_complete_stage(uuid, uuid);
CREATE OR REPLACE FUNCTION fn_complete_stage(p_building uuid, p_stage uuid, p_source text DEFAULT 'web')
RETURNS uuid  -- returns the new current_stage_id (NULL when the building is fully done)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_project uuid; v_type uuid; v_mem uuid; v_role org_role; v_next uuid; rec RECORD;
BEGIN
  SELECT b.org_id, b.project_id, b.building_type_id INTO v_org, v_project, v_type
  FROM buildings b WHERE b.id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;

  -- Engineer-or-above (the field persona), never the client role.
  SELECT id, role INTO v_mem, v_role FROM memberships
   WHERE user_id = auth.uid() AND org_id = v_org
     AND role IN ('admin','pm','engineer') AND is_active;
  IF v_mem IS NULL THEN
    RAISE EXCEPTION 'requires an active admin/pm/engineer of org %', v_org USING errcode = '42501';
  END IF;
  IF p_source NOT IN ('web','field') THEN RAISE EXCEPTION 'unknown source %', p_source; END IF;

  IF NOT EXISTS (SELECT 1 FROM type_stages WHERE id = p_stage AND building_type_id = v_type) THEN
    RAISE EXCEPTION 'stage % is not in this building''s type', p_stage;
  END IF;

  UPDATE building_stage_progress
     SET status = 'done', completed_at = NOW(),
         completed_by = v_mem, completed_source = p_source,
         approved_by = CASE WHEN v_role IN ('admin','pm') THEN v_mem ELSE NULL END,
         started_at = COALESCE(started_at, NOW())
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
          jsonb_build_object('stage', p_stage, 'next_stage', v_next, 'source', p_source));
  RETURN v_next;
END $$;
REVOKE EXECUTE ON FUNCTION fn_complete_stage(uuid, uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_complete_stage(uuid, uuid, text) TO authenticated;

-- The manager's revert for a wrong tick: back to in_progress, provenance cleared,
-- and the building's current stage rewound to the lowest not-done stage.
CREATE OR REPLACE FUNCTION fn_reopen_stage(p_building uuid, p_stage uuid)
RETURNS uuid  -- returns the new current_stage_id
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_type uuid; v_mem uuid; v_next uuid;
BEGIN
  SELECT b.org_id, b.building_type_id INTO v_org, v_type FROM buildings b WHERE b.id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  v_mem := fn_require_org_manager(v_org);

  IF NOT EXISTS (SELECT 1 FROM building_stage_progress
                  WHERE building_id = p_building AND stage_id = p_stage AND status = 'done') THEN
    RAISE EXCEPTION 'stage % is not done on this building', p_stage;
  END IF;

  UPDATE building_stage_progress
     SET status = 'in_progress', completed_at = NULL,
         approved_by = NULL, completed_by = NULL, completed_source = NULL
   WHERE building_id = p_building AND stage_id = p_stage;

  SELECT ts.id INTO v_next
  FROM type_stages ts
  JOIN building_stage_progress p ON p.stage_id = ts.id AND p.building_id = p_building
  WHERE ts.building_type_id = v_type AND p.status <> 'done'
  ORDER BY ts.sequence LIMIT 1;

  UPDATE buildings SET current_stage_id = v_next, status = 'in_progress' WHERE id = p_building;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'reopen_stage', 'buildings', p_building,
          jsonb_build_object('stage', p_stage, 'next_stage', v_next));
  RETURN v_next;
END $$;
REVOKE EXECUTE ON FUNCTION fn_reopen_stage(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_reopen_stage(uuid, uuid) TO authenticated;
