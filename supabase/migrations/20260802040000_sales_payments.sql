-- Sales & payment schedules (founder pilot, 2026-08-02). A sale = a party (buyer or
-- master-developer/partner) buying at a total price on a payment plan:
--   • BUYER  → a specific building, MILESTONE-linked (default 20/15/15/15/15/20).
--   • PARTNER/master developer → project-level, TIME-PHASED (default 30% + 4×17.5%
--     over months 0/6/12/18/24).
-- Money path (Rule 1): payments are append-only, idempotent, voidable; NO client write
-- policy — writes only via the SECURITY DEFINER functions below.

CREATE TABLE sales (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  building_id   UUID REFERENCES buildings(id) ON DELETE RESTRICT,     -- null = project-level (partner)
  party_name    TEXT NOT NULL,
  party_role    TEXT NOT NULL DEFAULT 'buyer',      -- buyer | partner
  party_email   TEXT,
  party_phone   TEXT,
  total_amount  NUMERIC(16,2) NOT NULL CHECK (total_amount >= 0),
  plan_type     TEXT NOT NULL DEFAULT 'milestone',  -- milestone | time_phased
  start_date    DATE NOT NULL DEFAULT CURRENT_DATE,  -- reference for time-phased due dates
  created_by    UUID REFERENCES memberships(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ
);
CREATE INDEX idx_sales_project ON sales(project_id) WHERE archived_at IS NULL;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY sales_select ON sales FOR SELECT
  USING (org_id = current_org_id() AND has_project_access(project_id));
GRANT SELECT ON sales TO authenticated;

CREATE TABLE payment_tranches (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id           UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  seq               INT NOT NULL,
  label             TEXT NOT NULL,
  percent           NUMERIC(6,3) NOT NULL CHECK (percent >= 0),
  trigger_milestone TEXT,     -- milestone plans (null on the first/booking tranche)
  due_month         INT,      -- time_phased plans: months after start_date
  UNIQUE (sale_id, seq)
);
ALTER TABLE payment_tranches ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_tranches_select ON payment_tranches FOR SELECT
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = payment_tranches.sale_id
                   AND s.org_id = current_org_id() AND has_project_access(s.project_id)));
GRANT SELECT ON payment_tranches TO authenticated;

CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id         UUID NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  amount          NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  paid_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  method          TEXT,
  note            TEXT,
  received_by     UUID REFERENCES memberships(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  voided_at       TIMESTAMPTZ,
  voided_by       UUID REFERENCES memberships(id),
  void_reason     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_sale ON payments(sale_id) WHERE voided_at IS NULL;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_select ON payments FOR SELECT
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = payments.sale_id
                   AND s.org_id = current_org_id() AND has_project_access(s.project_id)));
GRANT SELECT ON payments TO authenticated;
-- NO INSERT/UPDATE/DELETE policy (Rule 1): payments write only via the fns below.

-- ── default tranche templates ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn__seed_tranches(p_sale uuid, p_plan_type text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF p_plan_type = 'time_phased' THEN
    INSERT INTO payment_tranches (sale_id, seq, label, percent, due_month) VALUES
      (p_sale, 1, 'Initial',           30,   0),
      (p_sale, 2, 'Phase 1 (mo 0-6)',  17.5, 6),
      (p_sale, 3, 'Phase 2 (mo 7-12)', 17.5, 12),
      (p_sale, 4, 'Phase 3 (mo 13-18)',17.5, 18),
      (p_sale, 5, 'Phase 4 (mo 19-24)',17.5, 24);
  ELSE  -- milestone (buyer default)
    INSERT INTO payment_tranches (sale_id, seq, label, percent, trigger_milestone) VALUES
      (p_sale, 1, 'Booking',           20, NULL),
      (p_sale, 2, 'Foundation',        15, 'Foundation'),
      (p_sale, 3, 'Roofing',           15, 'Roofing'),
      (p_sale, 4, 'Walls & openings',  15, 'Walls & openings'),
      (p_sale, 5, 'Finishes',          15, 'Finishes'),
      (p_sale, 6, 'Handover',          20, 'Handover');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION fn_create_sale(
  p_org uuid, p_project uuid, p_building uuid, p_party_name text,
  p_party_role text, p_total numeric, p_plan_type text,
  p_email text DEFAULT NULL, p_phone text DEFAULT NULL, p_start date DEFAULT CURRENT_DATE)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  IF (SELECT org_id FROM projects WHERE id = p_project) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'project % is not in org %', p_project, p_org; END IF;
  IF p_building IS NOT NULL AND (SELECT project_id FROM buildings WHERE id = p_building) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'building % is not in project %', p_building, p_project; END IF;
  INSERT INTO sales (org_id, project_id, building_id, party_name, party_role, party_email,
                     party_phone, total_amount, plan_type, start_date, created_by)
  VALUES (p_org, p_project, p_building, p_party_name, COALESCE(p_party_role,'buyer'), p_email,
          p_phone, p_total, COALESCE(p_plan_type,'milestone'), COALESCE(p_start, CURRENT_DATE), v_mem)
  RETURNING id INTO v_id;
  PERFORM fn__seed_tranches(v_id, COALESCE(p_plan_type,'milestone'));
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (p_org, auth.uid(), 'create_sale', 'sales', v_id,
          jsonb_build_object('party', p_party_name, 'total', p_total, 'plan', p_plan_type));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_create_sale(uuid,uuid,uuid,text,text,numeric,text,text,text,date) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_sale(uuid,uuid,uuid,text,text,numeric,text,text,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION fn_record_payment(
  p_id uuid, p_sale uuid, p_amount numeric, p_idempotency_key text,
  p_paid_on date DEFAULT CURRENT_DATE, p_method text DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid; v_id uuid;
BEGIN
  SELECT org_id INTO v_org FROM sales WHERE id = p_sale;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown sale %', p_sale; END IF;
  v_mem := fn_require_org_manager(v_org);
  IF p_amount <= 0 THEN RAISE EXCEPTION 'payment amount must be > 0'; END IF;
  INSERT INTO payments (id, sale_id, amount, paid_on, method, note, received_by, idempotency_key)
  VALUES (COALESCE(p_id, gen_random_uuid()), p_sale, p_amount, COALESCE(p_paid_on, CURRENT_DATE),
          p_method, p_note, v_mem, p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN SELECT id INTO v_id FROM payments WHERE idempotency_key = p_idempotency_key; END IF;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'record_payment', 'payments', v_id,
          jsonb_build_object('sale', p_sale, 'amount', p_amount));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_record_payment(uuid,uuid,numeric,text,date,text,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_record_payment(uuid,uuid,numeric,text,date,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION fn_void_payment(p_payment uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid;
BEGIN
  SELECT s.org_id INTO v_org FROM payments p JOIN sales s ON s.id = p.sale_id WHERE p.id = p_payment;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown payment %', p_payment; END IF;
  v_mem := fn_require_org_manager(v_org);
  UPDATE payments SET voided_at = NOW(), voided_by = v_mem, void_reason = p_reason
   WHERE id = p_payment AND voided_at IS NULL;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'void_payment', 'payments', p_payment, jsonb_build_object('reason', p_reason));
END $$;
REVOKE EXECUTE ON FUNCTION fn_void_payment(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_void_payment(uuid, text) TO authenticated;

-- ── views: per-sale summary + per-tranche waterfall & due status ────────────
CREATE OR REPLACE VIEW sale_payment_summary WITH (security_invoker = true) AS
SELECT s.id AS sale_id, s.org_id, s.project_id, s.building_id, s.party_name, s.party_role,
       s.total_amount, s.plan_type, s.start_date,
       COALESCE(pd.paid, 0) AS paid,
       s.total_amount - COALESCE(pd.paid, 0) AS outstanding
FROM sales s
LEFT JOIN LATERAL (
  SELECT SUM(amount) AS paid FROM payments p WHERE p.sale_id = s.id AND p.voided_at IS NULL
) pd ON true
WHERE s.archived_at IS NULL;
GRANT SELECT ON sale_payment_summary TO authenticated;

-- Payments fill tranches in order (waterfall). A tranche is "due" when its milestone
-- is reached (milestone plans) or its month has arrived (time-phased); the booking
-- tranche (no trigger) is due immediately.
CREATE OR REPLACE VIEW payment_schedule WITH (security_invoker = true) AS
WITH t AS (
  SELECT pt.sale_id, pt.seq, pt.label, pt.percent, pt.trigger_milestone, pt.due_month,
         s.total_amount, s.start_date, s.building_id,
         pt.percent/100.0 * s.total_amount AS amount,
         SUM(pt.percent/100.0 * s.total_amount) OVER (PARTITION BY pt.sale_id ORDER BY pt.seq) AS cum_amount,
         COALESCE((SELECT SUM(amount) FROM payments p WHERE p.sale_id = pt.sale_id AND p.voided_at IS NULL), 0) AS paid_total
  FROM payment_tranches pt JOIN sales s ON s.id = pt.sale_id
)
SELECT sale_id, seq, label, percent, round(amount, 2) AS amount, trigger_milestone, due_month,
       round(LEAST(GREATEST(paid_total - (cum_amount - amount), 0), amount), 2) AS paid_toward,
       CASE WHEN paid_total >= cum_amount - 0.005 THEN 'paid'
            WHEN paid_total > cum_amount - amount + 0.005 THEN 'part'
            ELSE 'unpaid' END AS pay_status,
       CASE
         WHEN trigger_milestone = 'Handover' AND building_id IS NOT NULL THEN
           EXISTS (SELECT 1 FROM buildings b WHERE b.id = t.building_id AND b.status = 'done')
         WHEN trigger_milestone IS NOT NULL AND building_id IS NOT NULL THEN
           EXISTS (SELECT 1 FROM building_milestones bm
                    WHERE bm.building_id = t.building_id AND bm.milestone = t.trigger_milestone AND bm.status = 'done')
         WHEN due_month IS NOT NULL THEN (start_date + (due_month || ' months')::interval) <= now()
         WHEN trigger_milestone IS NULL AND due_month IS NULL THEN true
         ELSE false
       END AS is_due
FROM t;
GRANT SELECT ON payment_schedule TO authenticated;
