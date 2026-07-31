-- Archive (soft-delete) for buildings and recipes (building_types).
--
-- Pilot gap (M8): buildings were stamped from an EMPTY recipe and there was no way
-- to remove them, re-point them, or delete the recipe. Archive hides a building from
-- the Board and a recipe from the library while preserving the rows — reversible,
-- audit-friendly, and consistent with the append-only philosophy and the existing
-- projects-archive precedent. Every write is manager-gated + SECURITY DEFINER (Rule 1);
-- the tables keep NO client write policy.

-- ── buildings: archive columns ──────────────────────────────────────────────
ALTER TABLE buildings
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES memberships(id);

-- (project, code) uniqueness must apply to LIVE buildings only, so an archived
-- PE001 never blocks re-stamping PE001 onto the correct recipe.
ALTER TABLE buildings DROP CONSTRAINT IF EXISTS buildings_project_id_code_key;
CREATE UNIQUE INDEX IF NOT EXISTS buildings_project_code_live
  ON buildings (project_id, code) WHERE archived_at IS NULL;

-- building_types already carries archived_at + a partial index (v3_recipe_price);
-- add the actor so we know WHO archived a recipe.
ALTER TABLE building_types
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES memberships(id);

-- ── buildings: archive / unarchive ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_archive_building(p_building uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid; v_code text;
BEGIN
  SELECT b.org_id, b.code INTO v_org, v_code FROM buildings b WHERE b.id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  v_mem := fn_require_org_manager(v_org);

  UPDATE buildings
     SET archived_at = COALESCE(archived_at, NOW()), archived_by = v_mem
   WHERE id = p_building;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'archive_building', 'buildings', p_building,
          jsonb_build_object('code', v_code));
END $$;
REVOKE EXECUTE ON FUNCTION fn_archive_building(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_archive_building(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION fn_unarchive_building(p_building uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_code text;
BEGIN
  SELECT b.org_id, b.code INTO v_org, v_code FROM buildings b WHERE b.id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  PERFORM fn_require_org_manager(v_org);

  UPDATE buildings SET archived_at = NULL, archived_by = NULL WHERE id = p_building;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'unarchive_building', 'buildings', p_building,
          jsonb_build_object('code', v_code));
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'A live building already uses code % in this project — rename it first', v_code
    USING errcode = '23505';
END $$;
REVOKE EXECUTE ON FUNCTION fn_unarchive_building(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_unarchive_building(uuid) TO authenticated;

-- ── recipes (building_types): archive / unarchive ───────────────────────────
-- Guard: a recipe with LIVE buildings can't be archived — archive/move them first,
-- so no building is left pointing at a recipe hidden from the library.
CREATE OR REPLACE FUNCTION fn_archive_building_type(p_type uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid; v_name text; v_live int;
BEGIN
  SELECT bt.org_id, bt.name INTO v_org, v_name FROM building_types bt WHERE bt.id = p_type;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  v_mem := fn_require_org_manager(v_org);

  SELECT count(*) INTO v_live
    FROM buildings WHERE building_type_id = p_type AND archived_at IS NULL;
  IF v_live > 0 THEN
    RAISE EXCEPTION '% live building(s) still use this recipe — archive or move them first', v_live
      USING errcode = 'P0001';
  END IF;

  UPDATE building_types
     SET archived_at = COALESCE(archived_at, NOW()), archived_by = v_mem
   WHERE id = p_type;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'archive_building_type', 'building_types', p_type,
          jsonb_build_object('name', v_name));
END $$;
REVOKE EXECUTE ON FUNCTION fn_archive_building_type(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_archive_building_type(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION fn_unarchive_building_type(p_type uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_name text;
BEGIN
  SELECT bt.org_id, bt.name INTO v_org, v_name FROM building_types bt WHERE bt.id = p_type;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  PERFORM fn_require_org_manager(v_org);

  UPDATE building_types SET archived_at = NULL, archived_by = NULL WHERE id = p_type;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'unarchive_building_type', 'building_types', p_type,
          jsonb_build_object('name', v_name));
END $$;
REVOKE EXECUTE ON FUNCTION fn_unarchive_building_type(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_unarchive_building_type(uuid) TO authenticated;

-- ── board hides archived buildings ──────────────────────────────────────────
-- Same definition as m2d_batches_board, filtered to live buildings only.
CREATE OR REPLACE VIEW board_view WITH (security_invoker = on) AS
SELECT
  b.id, b.org_id, b.project_id, b.code, b.status,
  b.building_type_id, bt.name AS type_name, bt.version AS type_version,
  b.batch_id, ba.name AS batch_name,
  b.phase_id, ph.name AS phase_name,
  b.current_stage_id, cs.name AS current_stage_name, cs.sequence AS current_stage_seq,
  (SELECT count(*) FROM building_stage_progress p WHERE p.building_id = b.id AND p.status = 'done') AS stages_done,
  (SELECT count(*) FROM type_stages ts WHERE ts.building_type_id = b.building_type_id) AS stages_total,
  CASE
    WHEN b.status = 'done' THEN 'Done'
    WHEN (SELECT count(*) FROM building_stage_progress p
            WHERE p.building_id = b.id AND p.status IN ('in_progress','done')) = 0 THEN 'Not started'
    ELSE cs.name
  END AS board_column
FROM buildings b
JOIN building_types bt ON bt.id = b.building_type_id
LEFT JOIN type_stages cs ON cs.id = b.current_stage_id
LEFT JOIN batches ba ON ba.id = b.batch_id
LEFT JOIN phases  ph ON ph.id = b.phase_id
WHERE b.archived_at IS NULL;
GRANT SELECT ON board_view TO authenticated;
