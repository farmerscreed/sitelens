-- M4 · A — Offline daily-report sync backend (§9 F-9, §13, §5.3). daily_reports /
-- media / daily_report_media / daily_report_tasks have no client write policy (M0);
-- writes go through the SECURITY DEFINER functions below. The idempotency_key + the
-- no-op-on-retry logic are what make a flaky-3G resend safe (AC-1 / §13.2).

-- Private bucket for report media (thumb/display/original). Org-scoped by path.
INSERT INTO storage.buckets (id, name, public)
VALUES ('report-media', 'report-media', false)
ON CONFLICT (id) DO NOTHING;
DROP POLICY IF EXISTS report_media_read   ON storage.objects;
DROP POLICY IF EXISTS report_media_insert ON storage.objects;
CREATE POLICY report_media_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'report-media' AND (storage.foldername(name))[1] = current_org_id()::text);
CREATE POLICY report_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'report-media' AND (storage.foldername(name))[1] = current_org_id()::text);

-- helper: the caller's active membership in an org (NULL if not a member)
CREATE OR REPLACE FUNCTION fn__membership_in(p_org uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM memberships WHERE user_id = auth.uid() AND org_id = p_org AND is_active LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION fn__membership_in(uuid) FROM anon, public;

-- ── register a captured photo (three keys already uploaded) ─────────────────
-- Idempotent on the client-generated media id (retry = no-op). Computes geofence,
-- mock-location and a basic exact-phash duplicate flag at capture (F-9.4/9.5, AI-1 seam).
CREATE OR REPLACE FUNCTION fn_register_media(
  p_id uuid, p_org uuid, p_project uuid,
  p_key_thumb text, p_key_display text, p_key_original text,
  p_captured_at timestamptz DEFAULT NULL,
  p_lon double precision DEFAULT NULL, p_lat double precision DEFAULT NULL,
  p_gps_accuracy numeric DEFAULT NULL, p_mock_location boolean DEFAULT FALSE,
  p_phash bit(64) DEFAULT NULL, p_mime text DEFAULT NULL, p_bytes bigint DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mem uuid; v_point geography; v_within boolean; v_dup uuid;
BEGIN
  v_mem := fn__membership_in(p_org);
  IF v_mem IS NULL THEN RAISE EXCEPTION 'not a member of org %', p_org USING errcode = '42501'; END IF;
  IF p_project IS NOT NULL AND (SELECT org_id FROM projects WHERE id = p_project) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'project % not in org %', p_project, p_org; END IF;

  IF p_lon IS NOT NULL AND p_lat IS NOT NULL THEN
    v_point := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography;
    SELECT ST_DWithin(v_point, pr.centroid, pr.geofence_radius_m) INTO v_within
      FROM projects pr WHERE pr.id = p_project AND pr.centroid IS NOT NULL;
  END IF;

  IF p_phash IS NOT NULL THEN
    SELECT id INTO v_dup FROM media
     WHERE project_id = p_project AND phash = p_phash AND id <> p_id
       AND received_at > NOW() - INTERVAL '90 days' LIMIT 1;
  END IF;

  INSERT INTO media (id, org_id, project_id, key_thumb, key_display, key_original,
                     mime_type, bytes_original, captured_at, captured_point, gps_accuracy_m,
                     within_geofence, mock_location, phash, duplicate_of, uploaded_by)
  VALUES (p_id, p_org, p_project, p_key_thumb, p_key_display, p_key_original,
          p_mime, p_bytes, p_captured_at, v_point, p_gps_accuracy,
          v_within, p_mock_location, p_phash, v_dup, v_mem)
  ON CONFLICT (id) DO NOTHING;   -- retry = no-op
  RETURN p_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_register_media(uuid,uuid,uuid,text,text,text,timestamptz,double precision,double precision,numeric,boolean,bit,text,bigint) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_register_media(uuid,uuid,uuid,text,text,text,timestamptz,double precision,double precision,numeric,boolean,bit,text,bigint) TO authenticated;

-- ── submit a daily report (offline-safe) ────────────────────────────────────
-- Idempotent on idempotency_key: a resend after a lost ack returns the SAME report and
-- creates nothing new (AC-1 no-duplicate). A genuine second submission for the same
-- (project, date) is an amendment → new version (§13.3). Backdating limited to 3 days.
CREATE OR REPLACE FUNCTION fn_submit_daily_report(
  p_id uuid, p_project uuid, p_report_date date, p_work_summary text, p_idempotency_key text,
  p_building uuid DEFAULT NULL, p_weather text DEFAULT NULL, p_issues text DEFAULT NULL,
  p_lon double precision DEFAULT NULL, p_lat double precision DEFAULT NULL,
  p_device_captured_at timestamptz DEFAULT NULL, p_is_offline boolean DEFAULT FALSE,
  p_media uuid[] DEFAULT NULL, p_tasks jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_mem uuid; v_existing uuid; v_version int; v_point geography; mid uuid; t jsonb;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  v_mem := fn__membership_in(v_org);
  IF v_mem IS NULL THEN RAISE EXCEPTION 'not a member of the project''s org' USING errcode = '42501'; END IF;

  -- Idempotency: a retry with the same key is a no-op returning the existing report.
  SELECT id INTO v_existing FROM daily_reports WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_report_date > CURRENT_DATE THEN RAISE EXCEPTION 'report date is in the future'; END IF;
  IF p_report_date < CURRENT_DATE - 3 THEN RAISE EXCEPTION 'backdating limited to 3 days'; END IF;

  IF p_lon IS NOT NULL AND p_lat IS NOT NULL THEN
    v_point := ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography;
  END IF;

  -- Amendment for the same date → next version.
  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM daily_reports
   WHERE project_id = p_project AND report_date = p_report_date;

  BEGIN
    INSERT INTO daily_reports (id, project_id, report_date, version, submitted_by, work_summary,
                               weather, issues, status, is_offline_submission, submitted_point,
                               device_captured_at, building_id, idempotency_key)
    VALUES (p_id, p_project, p_report_date, v_version, v_mem, p_work_summary,
            p_weather, p_issues, 'pending', p_is_offline, v_point,
            p_device_captured_at, p_building, p_idempotency_key);
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent retry raced us; return whoever won.
    SELECT id INTO v_existing FROM daily_reports WHERE idempotency_key = p_idempotency_key;
    RETURN v_existing;
  END;

  IF p_media IS NOT NULL THEN
    FOREACH mid IN ARRAY p_media LOOP
      INSERT INTO daily_report_media (report_id, media_id) VALUES (p_id, mid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  IF p_tasks IS NOT NULL THEN
    FOR t IN SELECT jsonb_array_elements(p_tasks) LOOP
      INSERT INTO daily_report_tasks (report_id, task_id, progress_before, progress_after, note)
      VALUES (p_id, (t->>'task_id')::uuid, (t->>'progress_before')::int, (t->>'progress_after')::int, t->>'note')
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'submit_daily_report', 'daily_reports', p_id,
          jsonb_build_object('date', p_report_date, 'version', v_version, 'offline', p_is_offline));
  RETURN p_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_submit_daily_report(uuid,uuid,date,text,text,uuid,text,text,double precision,double precision,timestamptz,boolean,uuid[],jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_submit_daily_report(uuid,uuid,date,text,text,uuid,text,text,double precision,double precision,timestamptz,boolean,uuid[],jsonb) TO authenticated;
