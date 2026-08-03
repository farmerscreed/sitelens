-- Phase D (photo gallery) server side: photos become addressable PER BUILDING.
-- The field app has always tagged each shot to a house locally, but
-- fn_register_media had no way to receive it — galleries could only be derived
-- through the daily report (which may span several houses). Now:
--   • media.building_id (validated against the project, RESTRICT);
--   • fn_register_media takes p_building (old signature dropped — PostgREST
--     ambiguity, same move as portal_v2; named-arg callers are unaffected);
--   • existing photos back-filled from their report's building.
-- Reads stay RLS-scoped; the web gallery signs 15-minute URLs per SEC rules.

ALTER TABLE media ADD COLUMN IF NOT EXISTS building_id UUID REFERENCES buildings(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_media_building ON media (building_id) WHERE building_id IS NOT NULL;

DROP FUNCTION IF EXISTS fn_register_media(uuid,uuid,uuid,text,text,text,timestamptz,double precision,double precision,numeric,boolean,bit,text,bigint);
CREATE OR REPLACE FUNCTION fn_register_media(
  p_id uuid, p_org uuid, p_project uuid,
  p_key_thumb text, p_key_display text, p_key_original text,
  p_captured_at timestamptz DEFAULT NULL,
  p_lon double precision DEFAULT NULL, p_lat double precision DEFAULT NULL,
  p_gps_accuracy numeric DEFAULT NULL, p_mock_location boolean DEFAULT FALSE,
  p_phash bit(64) DEFAULT NULL, p_mime text DEFAULT NULL, p_bytes bigint DEFAULT NULL,
  p_building uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mem uuid; v_point geography; v_within boolean; v_dup uuid;
BEGIN
  v_mem := fn__membership_in(p_org);
  IF v_mem IS NULL THEN RAISE EXCEPTION 'not a member of org %', p_org USING errcode = '42501'; END IF;
  IF p_project IS NOT NULL AND (SELECT org_id FROM projects WHERE id = p_project) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'project % not in org %', p_project, p_org; END IF;
  IF p_building IS NOT NULL AND (SELECT project_id FROM buildings WHERE id = p_building) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'building % is not in project %', p_building, p_project; END IF;

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

  INSERT INTO media (id, org_id, project_id, building_id, key_thumb, key_display, key_original,
                     mime_type, bytes_original, captured_at, captured_point, gps_accuracy_m,
                     within_geofence, mock_location, phash, duplicate_of, uploaded_by)
  VALUES (p_id, p_org, p_project, p_building, p_key_thumb, p_key_display, p_key_original,
          p_mime, p_bytes, p_captured_at, v_point, p_gps_accuracy,
          v_within, p_mock_location, p_phash, v_dup, v_mem)
  ON CONFLICT (id) DO NOTHING;  -- idempotent: retry is a no-op
  RETURN p_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_register_media(uuid,uuid,uuid,text,text,text,timestamptz,double precision,double precision,numeric,boolean,bit,text,bigint,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_register_media(uuid,uuid,uuid,text,text,text,timestamptz,double precision,double precision,numeric,boolean,bit,text,bigint,uuid) TO authenticated;

-- Back-fill: a photo whose report covers exactly one building belongs to it.
UPDATE media m SET building_id = dr.building_id
FROM daily_report_media drm
JOIN daily_reports dr ON dr.id = drm.report_id
WHERE drm.media_id = m.id AND m.building_id IS NULL AND dr.building_id IS NOT NULL;
