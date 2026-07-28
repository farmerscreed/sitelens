-- ═══════════════════════════════════════════════════════════════════════════
-- M7 — notifications (dev_outbox) + weekly digest + spend anomaly. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj uuid := 'a5555555-5555-5555-5555-555555555555';
  s jsonb; a jsonb; n int; before int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub','a1111111-1111-1111-1111-111111111111')::text, true);

  -- fn_notify writes to the dev outbox.
  PERFORM fn_notify(org_a, 'sms', '+2348000000001', 'test', '{"hi":true}'::jsonb);
  IF (SELECT count(*) FROM dev_outbox WHERE org_id=org_a AND template='test') <> 1 THEN
    RAISE WARNING 'fn_notify did not write outbox'; fails:=fails+1; END IF;

  -- Weekly summary is structured (seed has a report today).
  s := fn_project_weekly_summary(proj);
  IF (s->>'reports')::int < 1 THEN RAISE WARNING 'weekly summary reports=% (exp >=1)', s->>'reports'; fails:=fails+1; END IF;
  IF NOT (s ? 'spend_approved' AND s ? 'low_stock' AND s ? 'stage_overruns') THEN
    RAISE WARNING 'weekly summary missing keys'; fails:=fails+1; END IF;

  -- Anomaly returns the shape.
  a := fn_spend_anomaly(proj);
  IF NOT (a ? 'this_week' AND a ? 'trailing_weekly_avg' AND a ? 'anomaly') THEN
    RAISE WARNING 'anomaly missing keys'; fails:=fails+1; END IF;

  -- The scheduled job writes one digest per active project.
  SELECT count(*) INTO before FROM dev_outbox WHERE template='weekly_digest';
  n := fn_run_weekly_digests();
  IF n < 1 THEN RAISE WARNING 'run_weekly_digests wrote nothing'; fails:=fails+1; END IF;
  IF (SELECT count(*) FROM dev_outbox WHERE template='weekly_digest') <> before + n THEN
    RAISE WARNING 'digest outbox count mismatch'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'M7 notify FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'M7 PASS: fn_notify→outbox; weekly summary + anomaly structured; run_weekly_digests wrote % digests.', n;
END $$;
ROLLBACK;
SELECT 'M7 notifications + digest: PASS' AS result;
