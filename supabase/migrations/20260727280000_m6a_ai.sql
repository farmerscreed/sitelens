-- M6 · AI layer (§11). Two no-model gates are pure arithmetic (AC-3 dup detection,
-- reorder advice); the inference loop (Rule 3) records every AI output as a proposal a
-- human disposes. ai_inferences/ai_models/report_embeddings exist (M0).

-- ── AI-1: perceptual-hash duplicate detection (no model) ────────────────────
-- Hamming distance over the 64-bit aHash. `#` is XOR on bit strings; the XOR result's
-- text is 64 chars of 0/1, so the count of '1's is the number of differing bits.
CREATE OR REPLACE FUNCTION fn_phash_hamming(a bit(64), b bit(64))
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT length(replace((a # b)::text, '0', ''));
$$;

-- Re-register fn_register_media (from M4) upgrading the duplicate flag from EXACT to
-- NEAR-duplicate: any earlier photo in the same project within 90 days whose hash is
-- within 8 bits. Re-encoding a resubmitted photo shifts a few bits, so exact match
-- missed real resubmissions — this catches them (AC-3).
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
     WHERE project_id = p_project AND phash IS NOT NULL AND id <> p_id
       AND received_at > NOW() - INTERVAL '90 days'
       AND fn_phash_hamming(phash, p_phash) <= 8
     ORDER BY fn_phash_hamming(phash, p_phash) ASC, received_at ASC
     LIMIT 1;
  END IF;

  INSERT INTO media (id, org_id, project_id, key_thumb, key_display, key_original,
                     mime_type, bytes_original, captured_at, captured_point, gps_accuracy_m,
                     within_geofence, mock_location, phash, duplicate_of, uploaded_by)
  VALUES (p_id, p_org, p_project, p_key_thumb, p_key_display, p_key_original,
          p_mime, p_bytes, p_captured_at, v_point, p_gps_accuracy,
          v_within, p_mock_location, p_phash, v_dup, v_mem)
  ON CONFLICT (id) DO NOTHING;
  RETURN p_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_register_media(uuid,uuid,uuid,text,text,text,timestamptz,double precision,double precision,numeric,boolean,bit,text,bigint) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_register_media(uuid,uuid,uuid,text,text,text,timestamptz,double precision,double precision,numeric,boolean,bit,text,bigint) TO authenticated;

-- ── AI-9: BOQ-aware reorder advice (no model) ───────────────────────────────
-- remaining requirement = Σ recipe over the project's buildings − Σ consumed (OUT);
-- order_qty = max(0, remaining − in-stock). Trustworthy because it is arithmetic over
-- the BOQ (§10.3), presented as a PROPOSAL the user acts on (Rule 3).
CREATE OR REPLACE FUNCTION fn_reorder_advice(p_project uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; result jsonb;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  IF fn__membership_in(v_org) IS NULL THEN
    RAISE EXCEPTION 'not a member of the project''s org' USING errcode = '42501'; END IF;

  WITH req AS (
    SELECT bi.material_id, SUM(bi.quantity) AS required
    FROM buildings b JOIN type_boq_items bi ON bi.building_type_id = b.building_type_id
    WHERE b.project_id = p_project GROUP BY bi.material_id
  ),
  con AS (
    SELECT mt.material_id, SUM(mt.quantity) AS consumed
    FROM material_transactions mt JOIN buildings b ON b.id = mt.building_id
    WHERE b.project_id = p_project AND mt.type = 'OUT' AND mt.voided_at IS NULL
    GROUP BY mt.material_id
  ),
  stock AS (
    SELECT material_id, balance FROM material_balances WHERE project_id = p_project
  )
  SELECT jsonb_agg(jsonb_build_object(
           'material_id', m.material_id,
           'material_name', mc.name,
           'required', COALESCE(req.required,0),
           'consumed', COALESCE(con.consumed,0),
           'in_stock', COALESCE(stock.balance,0),
           'remaining', GREATEST(COALESCE(req.required,0) - COALESCE(con.consumed,0), 0),
           'order_qty', GREATEST(COALESCE(req.required,0) - COALESCE(con.consumed,0) - COALESCE(stock.balance,0), 0)
         ) ORDER BY mc.name)
    INTO result
  FROM (SELECT material_id FROM req UNION SELECT material_id FROM con) m
  LEFT JOIN req  ON req.material_id  = m.material_id
  LEFT JOIN con  ON con.material_id  = m.material_id
  LEFT JOIN stock ON stock.material_id = m.material_id
  JOIN materials_catalog mc ON mc.id = m.material_id;

  RETURN COALESCE(result, '[]'::jsonb);
END $$;
REVOKE EXECUTE ON FUNCTION fn_reorder_advice(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_reorder_advice(uuid) TO authenticated;

-- ── the inference loop (Rule 3, §11.2) ──────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_record_inference(
  p_org uuid, p_subject_type text, p_output jsonb,
  p_project uuid DEFAULT NULL, p_model uuid DEFAULT NULL, p_subject_id uuid DEFAULT NULL,
  p_media uuid DEFAULT NULL, p_confidence numeric DEFAULT NULL, p_cost_estimate numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF fn__membership_in(p_org) IS NULL THEN
    RAISE EXCEPTION 'not a member of org %', p_org USING errcode = '42501'; END IF;
  INSERT INTO ai_inferences (org_id, project_id, model_id, subject_type, subject_id, media_id,
                             output, confidence, status, cost_estimate)
  VALUES (p_org, p_project, p_model, p_subject_type, p_subject_id, p_media,
          p_output, p_confidence, 'proposed', p_cost_estimate)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_record_inference(uuid,text,jsonb,uuid,uuid,uuid,uuid,numeric,numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_record_inference(uuid,text,jsonb,uuid,uuid,uuid,uuid,numeric,numeric) TO authenticated;

-- Human verdict: accept (human_value = the truth → training label) or reject.
CREATE OR REPLACE FUNCTION fn_resolve_inference(p_inference uuid, p_accept boolean, p_human_value jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid;
BEGIN
  SELECT org_id INTO v_org FROM ai_inferences WHERE id = p_inference;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown inference %', p_inference; END IF;
  v_mem := fn__membership_in(v_org);
  IF v_mem IS NULL THEN RAISE EXCEPTION 'not a member of the org' USING errcode = '42501'; END IF;
  UPDATE ai_inferences
     SET status = (CASE WHEN p_accept THEN 'accepted' ELSE 'rejected' END)::inference_status,
         human_value = p_human_value, reviewed_by = v_mem, reviewed_at = NOW()
   WHERE id = p_inference;
END $$;
REVOKE EXECUTE ON FUNCTION fn_resolve_inference(uuid, boolean, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_resolve_inference(uuid, boolean, jsonb) TO authenticated;

-- ── AI-8 retrieval: semantic match over report embeddings (pgvector) ────────
CREATE OR REPLACE FUNCTION fn_match_reports(p_project uuid, p_embedding vector(1536), p_k int DEFAULT 5)
RETURNS TABLE (report_id uuid, similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT re.report_id, 1 - (re.embedding <=> p_embedding) AS similarity
  FROM report_embeddings re
  JOIN daily_reports dr ON dr.id = re.report_id
  WHERE dr.project_id = p_project
    AND EXISTS (SELECT 1 FROM projects pr JOIN memberships m ON m.org_id = pr.org_id
                 WHERE pr.id = p_project AND m.user_id = auth.uid() AND m.is_active)
  ORDER BY re.embedding <=> p_embedding
  LIMIT p_k;
$$;
REVOKE EXECUTE ON FUNCTION fn_match_reports(uuid, vector, int) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_match_reports(uuid, vector, int) TO authenticated;
