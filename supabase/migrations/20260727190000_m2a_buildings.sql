-- M2 · A — Stamp buildings from a recipe version + phase/batch grouping (§2.1, §16.4).
-- buildings / phases / batches / building_stage_progress have NO client write policy
-- (M0); writes go through the SECURITY DEFINER, manager-gated functions below (Rule 1).

-- ── phases / batches (named groupings) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_create_phase(
  p_project uuid, p_name text, p_sequence int DEFAULT NULL,
  p_target_start date DEFAULT NULL, p_target_end date DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  PERFORM fn_require_org_manager(v_org);
  INSERT INTO phases (project_id, name, sequence, target_start, target_end)
  VALUES (p_project, p_name, p_sequence, p_target_start, p_target_end)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_create_phase(uuid, text, int, date, date) TO authenticated;

CREATE OR REPLACE FUNCTION fn_create_batch(
  p_project uuid, p_name text, p_phase uuid DEFAULT NULL,
  p_sequence int DEFAULT NULL, p_trigger_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  PERFORM fn_require_org_manager(v_org);
  INSERT INTO batches (project_id, phase_id, name, sequence, status, trigger_note)
  VALUES (p_project, p_phase, p_name, p_sequence, 'planned', p_trigger_note)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_create_batch(uuid, text, uuid, int, text) TO authenticated;

-- ── stamp N buildings from a type version ───────────────────────────────────
-- A building is a copy of a recipe (§2.1). It references the specific building_types
-- row (= a version), so later type edits (fn_new_type_version creates a new row) never
-- rewrite an existing building's requirements (F-TYPE-4). Each building inherits the
-- type's stages as building_stage_progress rows and starts at the first stage.
CREATE OR REPLACE FUNCTION fn_create_buildings(
  p_type uuid, p_count int, p_project uuid,
  p_batch uuid DEFAULT NULL, p_phase uuid DEFAULT NULL, p_code_prefix text DEFAULT 'B')
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_first uuid; v_start int; g int; v_bid uuid;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  PERFORM fn_require_org_manager(v_org);
  IF fn__type_org(p_type) IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'building type % is not in the project''s org', p_type USING errcode = '42501';
  END IF;
  IF p_count < 1 THEN RAISE EXCEPTION 'count must be >= 1'; END IF;
  IF p_batch IS NOT NULL AND NOT EXISTS (SELECT 1 FROM batches WHERE id = p_batch AND project_id = p_project) THEN
    RAISE EXCEPTION 'batch % is not in project %', p_batch, p_project; END IF;
  IF p_phase IS NOT NULL AND NOT EXISTS (SELECT 1 FROM phases WHERE id = p_phase AND project_id = p_project) THEN
    RAISE EXCEPTION 'phase % is not in project %', p_phase, p_project; END IF;

  SELECT id INTO v_first FROM type_stages WHERE building_type_id = p_type ORDER BY sequence LIMIT 1;
  SELECT count(*) INTO v_start FROM buildings WHERE project_id = p_project AND code LIKE p_code_prefix || '%';

  FOR g IN 1 .. p_count LOOP
    v_bid := gen_random_uuid();
    INSERT INTO buildings (id, org_id, project_id, building_type_id, code, phase_id, batch_id, current_stage_id, status)
    VALUES (v_bid, v_org, p_project, p_type,
            p_code_prefix || lpad((v_start + g)::text, 3, '0'),
            p_phase, p_batch, v_first, 'not_started');
    INSERT INTO building_stage_progress (building_id, stage_id, status)
    SELECT v_bid, ts.id, 'not_started' FROM type_stages ts WHERE ts.building_type_id = p_type;
  END LOOP;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'create_buildings', 'buildings', p_project,
          jsonb_build_object('type', p_type, 'count', p_count, 'batch', p_batch));
  RETURN p_count;
END $$;
GRANT EXECUTE ON FUNCTION fn_create_buildings(uuid, int, uuid, uuid, uuid, text) TO authenticated;
