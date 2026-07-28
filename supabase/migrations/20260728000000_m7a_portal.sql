-- M7 · A+B — Client portal (token+PIN, no user auth) + notifications (§9 F-13, §16.3,
-- SEC-11). portal_links/portal_access_log have no client write policy (M0); writes go
-- through the functions below. The portal READ path is fn_portal_view, granted to anon —
-- it never authenticates as a user and hand-selects safe columns (F-13.6).

-- ── notifications (dev outbox; same interface as prod WhatsApp/SMS/Resend) ──
CREATE TABLE dev_outbox (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  channel    TEXT NOT NULL,             -- whatsapp | sms | email | push
  recipient  TEXT NOT NULL,
  template   TEXT,
  payload    JSONB,
  status     TEXT DEFAULT 'queued',     -- dev: stays queued (logged); prod worker sends
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE dev_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY dev_outbox_select ON dev_outbox FOR SELECT USING (org_id = current_org_id());
GRANT SELECT ON dev_outbox TO authenticated;

CREATE OR REPLACE FUNCTION fn_notify(p_org uuid, p_channel text, p_recipient text, p_template text, p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO dev_outbox (org_id, channel, recipient, template, payload)
  VALUES (p_org, p_channel, p_recipient, p_template, p_payload) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_notify(uuid, text, text, text, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_notify(uuid, text, text, text, jsonb) TO authenticated;

-- ── create a portal link (Admin/PM) ─────────────────────────────────────────
-- Returns the token + PIN ONCE (shared with the recipient; only hashes are stored).
CREATE OR REPLACE FUNCTION fn_create_portal_link(
  p_project uuid, p_recipient_name text, p_recipient_phone text,
  p_show_line_items boolean DEFAULT FALSE, p_expiry_days int DEFAULT 90)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_org uuid; v_mem uuid; v_token text; v_pin text; v_id uuid;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  v_mem := fn_require_org_manager(v_org);

  v_token := encode(gen_random_bytes(24), 'hex');                 -- bearer token (shown once)
  v_pin   := lpad((floor(random() * 1000000))::int::text, 6, '0'); -- 6-digit PIN

  INSERT INTO portal_links (id, project_id, recipient_name, recipient_phone,
                            token_hash, pin_hash, show_line_items, expires_at, created_by)
  VALUES (gen_random_uuid(), p_project, p_recipient_name, p_recipient_phone,
          encode(digest(v_token, 'sha256'), 'hex'),         -- token hashed at rest
          crypt(v_pin, gen_salt('bf')),                     -- PIN bcrypt-hashed
          p_show_line_items, NOW() + make_interval(days => p_expiry_days), v_mem)
  RETURNING id INTO v_id;

  PERFORM fn_notify(v_org, 'whatsapp', p_recipient_phone, 'portal_link',
                    jsonb_build_object('link_id', v_id, 'recipient', p_recipient_name));

  RETURN jsonb_build_object('link_id', v_id, 'token', v_token, 'pin', v_pin);  -- shown once
END $$;
REVOKE EXECUTE ON FUNCTION fn_create_portal_link(uuid, text, text, boolean, int) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_portal_link(uuid, text, text, boolean, int) TO authenticated;

-- ── the portal read path (anon, token-keyed) ────────────────────────────────
-- Logs EVERY access, then enforces revoke/expiry/PIN. Returns a SAFE view only — no
-- supplier names, unit prices, or worker data (F-13.6).
CREATE OR REPLACE FUNCTION fn_portal_view(p_token text, p_pin text, p_ip inet DEFAULT NULL, p_ua text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_link portal_links%ROWTYPE; v_ok boolean; v_proj projects%ROWTYPE; v jsonb;
BEGIN
  SELECT * INTO v_link FROM portal_links WHERE token_hash = encode(digest(p_token, 'sha256'), 'hex');
  IF v_link.id IS NULL THEN RETURN jsonb_build_object('error', 'invalid link'); END IF;

  v_ok := (v_link.pin_hash = crypt(p_pin, v_link.pin_hash));
  -- Log every access. We RETURN errors (never RAISE) so this log always persists —
  -- a RAISE would roll the insert back with the failing call.
  INSERT INTO portal_access_log (link_id, ip_address, user_agent, pin_success)
  VALUES (v_link.id, p_ip, p_ua, v_ok);   -- (F-13.5 / SEC-11)

  IF v_link.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error', 'link revoked'); END IF;
  IF v_link.expires_at <= NOW()   THEN RETURN jsonb_build_object('error', 'link expired'); END IF;
  IF NOT v_ok                      THEN RETURN jsonb_build_object('error', 'invalid PIN'); END IF;

  SELECT * INTO v_proj FROM projects WHERE id = v_link.project_id;

  v := jsonb_build_object(
    'project', v_proj.name,
    'generated_at', NOW(),
    'progress', (
      SELECT jsonb_build_object('buildings_total', COUNT(*),
                                'buildings_done', COUNT(*) FILTER (WHERE status = 'done'),
                                'pct', CASE WHEN COUNT(*) = 0 THEN 0
                                       ELSE round(100.0 * COUNT(*) FILTER (WHERE status = 'done') / COUNT(*)) END)
      FROM buildings WHERE project_id = v_link.project_id),
    'spend', (
      SELECT jsonb_build_object(
        'budget', COALESCE((SELECT SUM(budgeted_amount) FROM budget_lines WHERE project_id = v_link.project_id), 0),
        'spent',  COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = v_link.project_id AND status = 'approved' AND voided_at IS NULL), 0),
        'committed', COALESCE((SELECT SUM(amount) FROM expenses WHERE project_id = v_link.project_id AND status = 'pending'), 0))),
    'photo_count', (SELECT COUNT(*) FROM media WHERE project_id = v_link.project_id),
    'line_items', CASE WHEN v_link.show_line_items THEN (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('category', category, 'amount', amount)), '[]'::jsonb)
        FROM expenses WHERE project_id = v_link.project_id AND status = 'approved' AND voided_at IS NULL
      ) ELSE NULL END
  );
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION fn_portal_view(text, text, inet, text) FROM public;
GRANT  EXECUTE ON FUNCTION fn_portal_view(text, text, inet, text) TO anon, authenticated;

-- ── revoke / renew (Admin/PM) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_revoke_portal_link(p_link uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT p.org_id INTO v_org FROM portal_links pl JOIN projects p ON p.id = pl.project_id WHERE pl.id = p_link;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown link %', p_link; END IF;
  PERFORM fn_require_org_manager(v_org);
  UPDATE portal_links SET revoked_at = NOW() WHERE id = p_link;
END $$;
REVOKE EXECUTE ON FUNCTION fn_revoke_portal_link(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_revoke_portal_link(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION fn_renew_portal_link(p_link uuid, p_days int DEFAULT 90)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT p.org_id INTO v_org FROM portal_links pl JOIN projects p ON p.id = pl.project_id WHERE pl.id = p_link;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown link %', p_link; END IF;
  PERFORM fn_require_org_manager(v_org);
  UPDATE portal_links SET expires_at = NOW() + make_interval(days => p_days), revoked_at = NULL WHERE id = p_link;
END $$;
REVOKE EXECUTE ON FUNCTION fn_renew_portal_link(uuid, int) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_renew_portal_link(uuid, int) TO authenticated;
