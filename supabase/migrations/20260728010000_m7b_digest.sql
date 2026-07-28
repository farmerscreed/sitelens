-- M7 · C — Weekly digest (AI-4) + spend anomaly (AI-5), scheduled via pg_cron. Numbers
-- come from SQL (deterministic); LLM prose is an optional DEV_AI_MODE polish in an edge fn.

-- Structured week-in-review for a project.
CREATE OR REPLACE FUNCTION fn_project_weekly_summary(p_project uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'project', (SELECT name FROM projects WHERE id = p_project),
    'week_ending', CURRENT_DATE,
    'reports', (SELECT COUNT(*) FROM daily_reports
                 WHERE project_id = p_project AND report_date > CURRENT_DATE - 7),
    'spend_approved', COALESCE((SELECT SUM(amount) FROM expenses
                 WHERE project_id = p_project AND status = 'approved' AND voided_at IS NULL
                   AND created_at > NOW() - INTERVAL '7 days'), 0),
    'stage_overruns', (SELECT COUNT(*) FROM audit_log
                 WHERE action = 'stage_overrun' AND occurred_at > NOW() - INTERVAL '7 days'
                   AND entity_id IN (SELECT id FROM buildings WHERE project_id = p_project)),
    'low_stock', (SELECT COALESCE(jsonb_agg(mc.name), '[]'::jsonb)
                 FROM material_balances mb JOIN materials_catalog mc ON mc.id = mb.material_id
                 WHERE mb.project_id = p_project AND mc.reorder_level IS NOT NULL AND mb.balance < mc.reorder_level)
  );
$$;
REVOKE EXECUTE ON FUNCTION fn_project_weekly_summary(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_project_weekly_summary(uuid) TO authenticated;

-- Spend anomaly: this week vs the trailing 4-week weekly average (flag if > 2×).
CREATE OR REPLACE FUNCTION fn_spend_anomaly(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_this numeric; v_avg numeric;
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_this FROM expenses
   WHERE project_id = p_project AND voided_at IS NULL AND created_at > NOW() - INTERVAL '7 days';
  SELECT COALESCE(SUM(amount), 0) / 4.0 INTO v_avg FROM expenses
   WHERE project_id = p_project AND voided_at IS NULL
     AND created_at BETWEEN NOW() - INTERVAL '35 days' AND NOW() - INTERVAL '7 days';
  RETURN jsonb_build_object('this_week', v_this, 'trailing_weekly_avg', v_avg,
    'anomaly', v_avg > 0 AND v_this > 2 * v_avg);
END $$;
REVOKE EXECUTE ON FUNCTION fn_spend_anomaly(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_spend_anomaly(uuid) TO authenticated;

-- Nightly/weekly job: write a digest notification per active project. System function
-- (no auth.uid()); only postgres/cron runs it.
CREATE OR REPLACE FUNCTION fn_run_weekly_digests()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r RECORD; n int := 0;
BEGIN
  FOR r IN SELECT p.id, p.org_id, p.name FROM projects p WHERE p.archived_at IS NULL LOOP
    INSERT INTO dev_outbox (org_id, channel, recipient, template, payload)
    VALUES (r.org_id, 'email', 'md', 'weekly_digest',
            jsonb_build_object('summary', fn_project_weekly_summary(r.id),
                               'anomaly', fn_spend_anomaly(r.id)));
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION fn_run_weekly_digests() FROM anon, public, authenticated;

-- Schedule Friday 06:00 (org timezone handling is a cloud concern). Best-effort so
-- db reset never breaks if pg_cron scheduling isn't available in this database.
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'sitelens-weekly-digest';
  PERFORM cron.schedule('sitelens-weekly-digest', '0 6 * * 5', 'SELECT fn_run_weekly_digests()');
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron scheduling skipped: %', SQLERRM;
END $$;
