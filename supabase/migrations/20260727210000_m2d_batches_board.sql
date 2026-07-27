-- M2 · D — Manual batch progression (F-BOARD-3) + the board view (F-BOARD-1/2).

-- Cost consequence of a batch = Σ live type cost over its buildings (reuses fn_type_cost,
-- so a price change re-costs it — ties to AC-7). Shown before "Start Batch".
CREATE OR REPLACE FUNCTION fn_batch_cost(p_batch uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM((SELECT total_cost FROM fn_type_cost(b.building_type_id))), 0)
  FROM buildings b
  WHERE b.batch_id = p_batch;
$$;
REVOKE EXECUTE ON FUNCTION fn_batch_cost(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_batch_cost(uuid) TO authenticated;

-- Advance a batch: a HUMAN decision, logged. The system never auto-starts the next
-- batch (F-BOARD-3) — it only surfaces state + consequence; a person presses start.
CREATE OR REPLACE FUNCTION fn_advance_batch(p_batch uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT p.org_id INTO v_org
  FROM batches ba JOIN projects p ON p.id = ba.project_id
  WHERE ba.id = p_batch;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown batch %', p_batch; END IF;
  PERFORM fn_require_org_manager(v_org);

  UPDATE batches SET status = 'active', started_at = COALESCE(started_at, NOW())
   WHERE id = p_batch;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'advance_batch', 'batches', p_batch,
          jsonb_build_object('started_at', NOW(), 'cost_at_start', fn_batch_cost(p_batch)));
END $$;
REVOKE EXECUTE ON FUNCTION fn_advance_batch(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_advance_batch(uuid) TO authenticated;

-- ── the board (F-BOARD-1/2) ─────────────────────────────────────────────────
-- One row per building with its type / batch / phase / current stage and the derived
-- board column. security_invoker=on so the underlying RLS (org + project access) is
-- evaluated as the QUERYING user, not the view owner — isolation still holds.
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
LEFT JOIN phases  ph ON ph.id = b.phase_id;
GRANT SELECT ON board_view TO authenticated;
