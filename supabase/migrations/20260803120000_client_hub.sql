-- Client hub (DECISIONS #64): a thin first-class `clients` directory over the
-- sales/portal/milestone layer — NOT a CRM. One row per person/company so a buyer
-- can own >1 house, a partner can recur, and notes + portal links attach to a
-- person. Design: docs/CLIENT_HUB.md. Revisions agreed 2026-08-03:
--   • the client is the front door of a sale (sale form get-or-creates the client);
--     party_name on sales stays as a denormalised display/legacy field;
--   • duplicate guard: one ACTIVE client per (org, email);
--   • `kind` (buyer/partner/both) is DERIVED from their sales, never stored;
--   • collections surface on the dashboard (due_now / overdue in client_summary).
-- The client record itself is not money, but it links to sales/payments, so all
-- writes go through SECURITY DEFINER functions (Rule 1) and there is no client
-- write policy.

CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  full_name   TEXT NOT NULL CHECK (btrim(full_name) <> ''),
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  created_by  UUID REFERENCES memberships(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
-- Same email = same person: one active client per (org, email).
CREATE UNIQUE INDEX uq_clients_org_email ON clients (org_id, lower(email))
  WHERE email IS NOT NULL AND archived_at IS NULL;
CREATE INDEX idx_clients_org ON clients (org_id) WHERE archived_at IS NULL;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY clients_select ON clients FOR SELECT USING (org_id = current_org_id());
GRANT SELECT ON clients TO authenticated;
-- NO INSERT/UPDATE/DELETE policy (Rule 1): writes only via the fns below.

ALTER TABLE sales        ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE RESTRICT;
ALTER TABLE portal_links ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE RESTRICT;
CREATE INDEX idx_sales_client        ON sales (client_id) WHERE archived_at IS NULL;
CREATE INDEX idx_portal_links_client ON portal_links (client_id);

-- ── write path ──────────────────────────────────────────────────────────────

-- Get-or-create: an email match on an active client returns that client (filling
-- a missing phone) instead of creating a duplicate.
CREATE OR REPLACE FUNCTION fn_create_client(
  p_org uuid, p_full_name text, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mem uuid; v_id uuid;
  v_email text := NULLIF(lower(btrim(COALESCE(p_email, ''))), '');
BEGIN
  v_mem := fn_require_org_manager(p_org);
  IF btrim(COALESCE(p_full_name, '')) = '' THEN RAISE EXCEPTION 'client name is required'; END IF;
  IF v_email IS NOT NULL THEN
    SELECT id INTO v_id FROM clients
     WHERE org_id = p_org AND lower(email) = v_email AND archived_at IS NULL;
    IF v_id IS NOT NULL THEN
      UPDATE clients SET phone = COALESCE(phone, NULLIF(btrim(COALESCE(p_phone,'')), '')) WHERE id = v_id;
      RETURN v_id;
    END IF;
  END IF;
  INSERT INTO clients (org_id, full_name, email, phone, notes, created_by)
  VALUES (p_org, btrim(p_full_name), v_email,
          NULLIF(btrim(COALESCE(p_phone,'')), ''), NULLIF(btrim(COALESCE(p_notes,'')), ''), v_mem)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (p_org, auth.uid(), 'create_client', 'clients', v_id,
          jsonb_build_object('name', btrim(p_full_name), 'email', v_email));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_create_client(uuid,text,text,text,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_client(uuid,text,text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION fn_update_client(
  p_client uuid, p_full_name text, p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL, p_notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM clients WHERE id = p_client;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown client %', p_client; END IF;
  PERFORM fn_require_org_manager(v_org);
  IF btrim(COALESCE(p_full_name, '')) = '' THEN RAISE EXCEPTION 'client name is required'; END IF;
  UPDATE clients
     SET full_name = btrim(p_full_name),
         email     = NULLIF(lower(btrim(COALESCE(p_email,''))), ''),
         phone     = NULLIF(btrim(COALESCE(p_phone,'')), ''),
         notes     = NULLIF(btrim(COALESCE(p_notes,'')), '')
   WHERE id = p_client;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'update_client', 'clients', p_client,
          jsonb_build_object('name', btrim(p_full_name)));
END $$;
REVOKE EXECUTE ON FUNCTION fn_update_client(uuid,text,text,text,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_update_client(uuid,text,text,text,text) TO authenticated;

-- Soft-delete. You cannot hide someone who still owes money: blocked while any
-- live sale of theirs has an outstanding balance.
CREATE OR REPLACE FUNCTION fn_archive_client(p_client uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_out numeric;
BEGIN
  SELECT org_id INTO v_org FROM clients WHERE id = p_client;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown client %', p_client; END IF;
  PERFORM fn_require_org_manager(v_org);
  SELECT COALESCE(SUM(sps.outstanding), 0) INTO v_out
    FROM sales s JOIN sale_payment_summary sps ON sps.sale_id = s.id
   WHERE s.client_id = p_client;
  IF v_out > 0 THEN
    RAISE EXCEPTION 'client still owes %: settle or void their sales first', v_out;
  END IF;
  UPDATE clients SET archived_at = NOW() WHERE id = p_client AND archived_at IS NULL;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id)
  VALUES (v_org, auth.uid(), 'archive_client', 'clients', p_client);
END $$;
REVOKE EXECUTE ON FUNCTION fn_archive_client(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_archive_client(uuid) TO authenticated;

-- Link (or relink) an existing sale to a client — the back-fill path for sales
-- recorded before the hub existed.
CREATE OR REPLACE FUNCTION fn_link_sale_client(p_sale uuid, p_client uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_client_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM sales WHERE id = p_sale;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown sale %', p_sale; END IF;
  PERFORM fn_require_org_manager(v_org);
  SELECT org_id INTO v_client_org FROM clients WHERE id = p_client AND archived_at IS NULL;
  IF v_client_org IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'client % is not an active client of this org', p_client; END IF;
  UPDATE sales SET client_id = p_client WHERE id = p_sale;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'link_sale_client', 'sales', p_sale,
          jsonb_build_object('client', p_client));
END $$;
REVOKE EXECUTE ON FUNCTION fn_link_sale_client(uuid,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_link_sale_client(uuid,uuid) TO authenticated;

-- ── the client becomes the front door of a sale / portal link ───────────────
-- Recreate with an optional p_client (drop first: keeping both signatures would
-- make PostgREST rpc calls ambiguous — same move as portal_v2).

DROP FUNCTION IF EXISTS fn_create_sale(uuid,uuid,uuid,text,text,numeric,text,text,text,date);
CREATE OR REPLACE FUNCTION fn_create_sale(
  p_org uuid, p_project uuid, p_building uuid, p_party_name text,
  p_party_role text, p_total numeric, p_plan_type text,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_start date DEFAULT CURRENT_DATE,
  p_client uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  IF (SELECT org_id FROM projects WHERE id = p_project) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'project % is not in org %', p_project, p_org; END IF;
  IF p_building IS NOT NULL AND (SELECT project_id FROM buildings WHERE id = p_building) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'building % is not in project %', p_building, p_project; END IF;
  IF p_client IS NOT NULL AND
     (SELECT org_id FROM clients WHERE id = p_client AND archived_at IS NULL) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'client % is not an active client of org %', p_client, p_org; END IF;
  INSERT INTO sales (org_id, project_id, building_id, client_id, party_name, party_role, party_email,
                     party_phone, total_amount, plan_type, start_date, created_by)
  VALUES (p_org, p_project, p_building, p_client, p_party_name, COALESCE(p_party_role,'buyer'), p_email,
          p_phone, p_total, COALESCE(p_plan_type,'milestone'), COALESCE(p_start, CURRENT_DATE), v_mem)
  RETURNING id INTO v_id;
  PERFORM fn__seed_tranches(v_id, COALESCE(p_plan_type,'milestone'));
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (p_org, auth.uid(), 'create_sale', 'sales', v_id,
          jsonb_build_object('party', p_party_name, 'total', p_total, 'plan', p_plan_type, 'client', p_client));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_create_sale(uuid,uuid,uuid,text,text,numeric,text,text,text,date,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_sale(uuid,uuid,uuid,text,text,numeric,text,text,text,date,uuid) TO authenticated;

DROP FUNCTION IF EXISTS fn_create_portal_link(uuid,text,text,boolean,int,text,uuid,text);
CREATE OR REPLACE FUNCTION fn_create_portal_link(
  p_project uuid, p_recipient_name text, p_recipient_phone text,
  p_show_line_items boolean DEFAULT FALSE, p_expiry_days int DEFAULT 90,
  p_link_type text DEFAULT 'partner', p_building uuid DEFAULT NULL, p_email text DEFAULT NULL,
  p_client uuid DEFAULT NULL)
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
  IF p_client IS NOT NULL AND
     (SELECT org_id FROM clients WHERE id = p_client AND archived_at IS NULL) IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'client % is not an active client of this org', p_client; END IF;

  v_token := encode(gen_random_bytes(24), 'hex');
  v_pin   := lpad((floor(random() * 1000000))::int::text, 6, '0');

  INSERT INTO portal_links (id, project_id, recipient_name, recipient_phone, recipient_email,
                            link_type, building_id, client_id, token_hash, pin_hash, show_line_items, expires_at, created_by)
  VALUES (gen_random_uuid(), p_project, p_recipient_name, p_recipient_phone, p_email,
          COALESCE(p_link_type,'partner'), p_building, p_client,
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
REVOKE EXECUTE ON FUNCTION fn_create_portal_link(uuid,text,text,boolean,int,text,uuid,text,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_portal_link(uuid,text,text,boolean,int,text,uuid,text,uuid) TO authenticated;

-- ── the directory view ──────────────────────────────────────────────────────
-- One row per active client: derived kind, rolled-up money, and the collections
-- signal (due_now = triggered-but-unpaid tranche remainder across their sales).
CREATE OR REPLACE VIEW client_summary WITH (security_invoker = true) AS
SELECT c.id AS client_id, c.org_id, c.full_name, c.email, c.phone, c.notes, c.created_at,
       r.kind,
       COALESCE(r.sale_count, 0)     AS sale_count,
       COALESCE(r.houses, 0)         AS houses,
       COALESCE(r.contract_value, 0) AS contract_value,
       COALESCE(r.paid, 0)           AS paid,
       COALESCE(r.outstanding, 0)    AS outstanding,
       COALESCE(d.due_now, 0)        AS due_now,
       d.next_due_label,
       COALESCE(d.due_now, 0) > 0    AS overdue
FROM clients c
LEFT JOIN LATERAL (
  SELECT count(*) AS sale_count,
         count(*) FILTER (WHERE sps.building_id IS NOT NULL) AS houses,
         CASE WHEN count(*) = 0 THEN NULL
              WHEN bool_or(sps.party_role = 'partner') AND bool_or(sps.party_role <> 'partner') THEN 'both'
              WHEN bool_or(sps.party_role = 'partner') THEN 'partner'
              ELSE 'buyer' END AS kind,
         SUM(sps.total_amount) AS contract_value,
         SUM(sps.paid)         AS paid,
         SUM(sps.outstanding)  AS outstanding
  FROM sales s JOIN sale_payment_summary sps ON sps.sale_id = s.id
  WHERE s.client_id = c.id
) r ON true
LEFT JOIN LATERAL (
  SELECT SUM(ps.amount - ps.paid_toward) AS due_now,
         (array_agg(ps.label ORDER BY s.start_date, ps.seq))[1] AS next_due_label
  FROM sales s JOIN payment_schedule ps ON ps.sale_id = s.id
  WHERE s.client_id = c.id AND s.archived_at IS NULL
    AND ps.is_due AND ps.pay_status <> 'paid'
) d ON true
WHERE c.archived_at IS NULL;
GRANT SELECT ON client_summary TO authenticated;

-- ── back-fill the handful of pre-hub rows ───────────────────────────────────
-- One client per distinct person already on live sales (email identity first,
-- else name), then link those sales and any portal links sharing the email.
INSERT INTO clients (org_id, full_name, email, phone)
SELECT DISTINCT ON (s.org_id, COALESCE(NULLIF(lower(btrim(s.party_email)),''), lower(btrim(s.party_name))))
       s.org_id, btrim(s.party_name),
       NULLIF(lower(btrim(COALESCE(s.party_email,''))), ''),
       NULLIF(btrim(COALESCE(s.party_phone,'')), '')
FROM sales s
WHERE s.archived_at IS NULL AND s.client_id IS NULL
ORDER BY s.org_id, COALESCE(NULLIF(lower(btrim(s.party_email)),''), lower(btrim(s.party_name))), s.created_at;

UPDATE sales s SET client_id = c.id
FROM clients c
WHERE s.client_id IS NULL AND s.archived_at IS NULL
  AND c.org_id = s.org_id AND c.archived_at IS NULL
  AND ((NULLIF(lower(btrim(s.party_email)),'') IS NOT NULL AND c.email = lower(btrim(s.party_email)))
    OR (NULLIF(lower(btrim(s.party_email)),'') IS NULL AND lower(c.full_name) = lower(btrim(s.party_name))));

UPDATE portal_links pl SET client_id = c.id
FROM projects p, clients c
WHERE pl.client_id IS NULL AND p.id = pl.project_id
  AND c.org_id = p.org_id AND c.archived_at IS NULL
  AND c.email = NULLIF(lower(btrim(COALESCE(pl.recipient_email,''))), '');
