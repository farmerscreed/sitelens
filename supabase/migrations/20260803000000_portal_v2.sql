-- Portal v2: two audiences + email delivery (founder pilot, 2026-08-03).
-- A link is a BUYER link (scoped to one building — milestones, progress, payment status,
-- photos; NO project money) or a PARTNER link (project-wide — units-at-milestone,
-- progress, partnership financials, sales, photos). fn_portal_view still hand-selects
-- SAFE columns only (no supplier / unit price / worker data — F-13.6). Links can be
-- delivered by email as well as phone.

ALTER TABLE portal_links
  ADD COLUMN IF NOT EXISTS link_type       TEXT NOT NULL DEFAULT 'partner',  -- buyer | partner
  ADD COLUMN IF NOT EXISTS building_id     UUID REFERENCES buildings(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS recipient_email TEXT;

-- Recreate the creator with audience + email (old 5-arg calls still work via defaults).
DROP FUNCTION IF EXISTS fn_create_portal_link(uuid, text, text, boolean, int);
CREATE OR REPLACE FUNCTION fn_create_portal_link(
  p_project uuid, p_recipient_name text, p_recipient_phone text,
  p_show_line_items boolean DEFAULT FALSE, p_expiry_days int DEFAULT 90,
  p_link_type text DEFAULT 'partner', p_building uuid DEFAULT NULL, p_email text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org uuid; v_mem uuid; v_token text; v_pin text; v_id uuid;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  v_mem := fn_require_org_manager(v_org);
  IF p_link_type = 'buyer' AND p_building IS NULL THEN
    RAISE EXCEPTION 'a buyer link needs a building'; END IF;
  IF p_building IS NOT NULL AND (SELECT project_id FROM buildings WHERE id = p_building) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'building % is not in project %', p_building, p_project; END IF;

  v_token := encode(gen_random_bytes(24), 'hex');
  v_pin   := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO portal_links (id, project_id, recipient_name, recipient_phone, recipient_email,
                            link_type, building_id, token_hash, pin_hash, show_line_items, expires_at, created_by)
  VALUES (gen_random_uuid(), p_project, p_recipient_name, p_recipient_phone, p_email,
          COALESCE(p_link_type,'partner'), p_building,
          encode(digest(v_token, 'sha256'), 'hex'), crypt(v_pin, gen_salt('bf')),
          p_show_line_items, NOW() + make_interval(days => p_expiry_days), v_mem)
  RETURNING id INTO v_id;

  -- Deliver by email if given, else phone (dev outbox; prod worker sends).
  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    PERFORM fn_notify(v_org, 'email', p_email, 'portal_link', jsonb_build_object('link_id', v_id, 'recipient', p_recipient_name));
  ELSIF p_recipient_phone IS NOT NULL AND btrim(p_recipient_phone) <> '' THEN
    PERFORM fn_notify(v_org, 'whatsapp', p_recipient_phone, 'portal_link', jsonb_build_object('link_id', v_id, 'recipient', p_recipient_name));
  END IF;

  RETURN jsonb_build_object('link_id', v_id, 'token', v_token, 'pin', v_pin);
END $$;
REVOKE EXECUTE ON FUNCTION fn_create_portal_link(uuid,text,text,boolean,int,text,uuid,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_portal_link(uuid,text,text,boolean,int,text,uuid,text) TO authenticated;

-- The read path: audience-shaped payload, still safe-columns-only.
CREATE OR REPLACE FUNCTION fn_portal_view(p_token text, p_pin text, p_ip inet DEFAULT NULL, p_ua text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_link portal_links%ROWTYPE; v_ok boolean; v_proj projects%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO v_link FROM portal_links WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex');
  IF v_link.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid link'); END IF;

  v_ok := (v_link.pin_hash = crypt(p_pin, v_link.pin_hash));
  INSERT INTO portal_access_log (link_id, ip_address, user_agent, pin_success)
  VALUES (v_link.id, p_ip, p_ua, v_ok);

  IF v_link.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'link revoked'); END IF;
  IF v_link.expires_at <= NOW()   THEN RETURN jsonb_build_object('error', 'link expired'); END IF;
  IF NOT v_ok                      THEN RETURN jsonb_build_object('error', 'invalid PIN'); END IF;

  SELECT * INTO v_proj FROM projects WHERE id = v_link.project_id;

  IF v_link.link_type = 'buyer' AND v_link.building_id IS NOT NULL THEN
    v := jsonb_build_object(
      'view', 'buyer',
      'project', v_proj.name,
      'building_code', (SELECT code FROM buildings WHERE id = v_link.building_id),
      'generated_at', NOW(),
      'progress_pct', (SELECT CASE WHEN COALESCE(SUM(planned_value),0)=0 THEN 0
                             ELSE round(100.0 * COALESCE(SUM(earned_value),0) / SUM(planned_value)) END
                       FROM building_work_ev WHERE building_id = v_link.building_id),
      'milestones', (SELECT COALESCE(jsonb_agg(jsonb_build_object('milestone', milestone, 'status', status) ORDER BY milestone_order), '[]'::jsonb)
                     FROM building_milestones WHERE building_id = v_link.building_id AND milestone <> 'Other'),
      'photo_count', (SELECT COUNT(*) FROM daily_report_media drm
                        JOIN daily_reports dr ON dr.id = drm.report_id
                       WHERE dr.building_id = v_link.building_id),
      'payment', (
        SELECT jsonb_build_object('total', sps.total_amount, 'paid', sps.paid, 'outstanding', sps.outstanding,
                 'schedule', (SELECT COALESCE(jsonb_agg(jsonb_build_object('label', ps.label, 'amount', ps.amount,
                                'status', ps.pay_status, 'due', ps.is_due) ORDER BY ps.seq), '[]'::jsonb)
                              FROM payment_schedule ps WHERE ps.sale_id = sps.sale_id))
        FROM sale_payment_summary sps
        WHERE sps.building_id = v_link.building_id AND sps.party_role = 'buyer' LIMIT 1)
    );
  ELSE
    v := jsonb_build_object(
      'view', 'partner',
      'project', v_proj.name,
      'generated_at', NOW(),
      'progress', (SELECT jsonb_build_object('buildings_total', COUNT(*),
                          'buildings_done', COUNT(*) FILTER (WHERE status='done'),
                          'pct', CASE WHEN COUNT(*)=0 THEN 0 ELSE round(100.0*COUNT(*) FILTER (WHERE status='done')/COUNT(*)) END)
                   FROM buildings WHERE project_id = v_link.project_id AND archived_at IS NULL),
      'units_by_milestone', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('milestone', milestone, 'reached', reached, 'total', total) ORDER BY ord), '[]'::jsonb)
        FROM (SELECT milestone, min(milestone_order) AS ord,
                     COUNT(*) FILTER (WHERE status='done') AS reached, COUNT(DISTINCT building_id) AS total
              FROM building_milestones WHERE project_id = v_link.project_id AND milestone <> 'Other'
              GROUP BY milestone) q),
      'financials', jsonb_build_object(
        'budget', COALESCE((SELECT SUM(budgeted_amount) FROM budget_lines WHERE project_id = v_link.project_id), 0),
        'spent',  COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = v_link.project_id AND status='approved' AND voided_at IS NULL), 0)),
      'sales', (SELECT jsonb_build_object('units_sold', COUNT(*),
                       'contract_value', COALESCE(SUM(total_amount),0), 'collected', COALESCE(SUM(paid),0))
                FROM sale_payment_summary WHERE project_id = v_link.project_id AND party_role='buyer'),
      'photo_count', (SELECT COUNT(*) FROM media WHERE project_id = v_link.project_id)
    );
  END IF;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION fn_portal_view(text, text, inet, text) FROM public;
GRANT  EXECUTE ON FUNCTION fn_portal_view(text, text, inet, text) TO anon, authenticated;
