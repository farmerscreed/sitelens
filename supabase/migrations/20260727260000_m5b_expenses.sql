-- M5 · B — Expenses + approval thresholds (§9 F-11, §16.4). expenses has NO client
-- write policy (M0). An unapproved expense is COMMITTED, not SPENT (status 'pending')
-- until an authorised approver signs off (AC-11). Thresholds are per-org configurable
-- in organizations.settings.expense_thresholds (default PM ≤ ₦50k, Admin > ₦250k).

CREATE OR REPLACE FUNCTION fn_create_expense(
  p_id uuid, p_project uuid, p_budget_line uuid, p_amount numeric, p_idempotency_key text,
  p_category text DEFAULT NULL, p_description text DEFAULT NULL, p_paid_to text DEFAULT NULL,
  p_method text DEFAULT NULL, p_building uuid DEFAULT NULL, p_receipt_media uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_mem uuid; v_existing uuid;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  v_mem := fn__membership_in(v_org);
  IF v_mem IS NULL THEN RAISE EXCEPTION 'not a member of the project''s org' USING errcode = '42501'; END IF;

  SELECT id INTO v_existing FROM expenses WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be > 0'; END IF;
  IF p_budget_line IS NULL THEN RAISE EXCEPTION 'budget line is mandatory (F-11.1)'; END IF;
  IF (SELECT project_id FROM budget_lines WHERE id = p_budget_line) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'budget line % is not in project %', p_budget_line, p_project; END IF;
  IF p_building IS NOT NULL AND (SELECT project_id FROM buildings WHERE id = p_building) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'building % is not in project %', p_building, p_project; END IF;

  INSERT INTO expenses (id, project_id, budget_line_id, category, amount, description, paid_to,
                        payment_method, receipt_media_id, status, source, building_id, created_by, idempotency_key)
  VALUES (p_id, p_project, p_budget_line, p_category, p_amount, p_description, p_paid_to,
          p_method, p_receipt_media, 'pending', 'manual', p_building, v_mem, p_idempotency_key);

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'create_expense', 'expenses', p_id,
          jsonb_build_object('amount', p_amount, 'status', 'pending'));
  RETURN p_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_create_expense(uuid,uuid,uuid,numeric,text,text,text,text,text,uuid,uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_expense(uuid,uuid,uuid,numeric,text,text,text,text,text,uuid,uuid) TO authenticated;

-- ── approve: the approver must have authority for the amount (AC-11) ────────
CREATE OR REPLACE FUNCTION fn_approve_expense(p_expense uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_amount numeric; v_status approval_status; v_role org_role;
  v_admin_thr numeric; v_thr jsonb;
BEGIN
  SELECT p.org_id, e.amount, e.status INTO v_org, v_amount, v_status
  FROM expenses e JOIN projects p ON p.id = e.project_id WHERE e.id = p_expense;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown expense %', p_expense; END IF;
  IF v_status <> 'pending' THEN RAISE EXCEPTION 'expense is not pending (%)', v_status; END IF;

  SELECT role INTO v_role FROM memberships WHERE user_id = auth.uid() AND org_id = v_org AND is_active;
  IF v_role IS NULL OR v_role NOT IN ('pm','admin') THEN
    RAISE EXCEPTION 'only a PM or Admin may approve expenses' USING errcode = '42501'; END IF;

  v_thr := COALESCE((SELECT settings->'expense_thresholds' FROM organizations WHERE id = v_org), '{}'::jsonb);
  v_admin_thr := COALESCE((v_thr->>'admin')::numeric, 250000);
  IF v_amount > v_admin_thr AND v_role <> 'admin' THEN
    RAISE EXCEPTION 'amounts over % require Admin approval', v_admin_thr USING errcode = '42501'; END IF;

  UPDATE expenses SET status = 'approved', approved_by = fn__membership_in(v_org), approved_at = NOW()
   WHERE id = p_expense;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'approve_expense', 'expenses', p_expense,
          jsonb_build_object('amount', v_amount, 'approver_role', v_role));
END $$;
REVOKE EXECUTE ON FUNCTION fn_approve_expense(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_approve_expense(uuid) TO authenticated;

-- ── void (Admin only, reason, audited — F-11.3) ─────────────────────────────
CREATE OR REPLACE FUNCTION fn_void_expense(p_expense uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'void reason required'; END IF;
  SELECT p.org_id INTO v_org FROM expenses e JOIN projects p ON p.id = e.project_id WHERE e.id = p_expense;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown expense %', p_expense; END IF;
  PERFORM fn_require_org_admin(v_org);
  UPDATE expenses SET status = 'voided', voided_at = NOW(), voided_by = fn__membership_in(v_org), void_reason = p_reason
   WHERE id = p_expense AND voided_at IS NULL;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, reason)
  VALUES (v_org, auth.uid(), 'void_expense', 'expenses', p_expense, p_reason);
END $$;
REVOKE EXECUTE ON FUNCTION fn_void_expense(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_void_expense(uuid, text) TO authenticated;
