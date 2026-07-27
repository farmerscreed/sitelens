-- M5 · A — Materials money-path (§9 F-10, §16.4). materials_catalog /
-- material_transactions / material_balances have NO client write policy (M0); every
-- write goes through the SECURITY DEFINER functions here. The row-locked balance +
-- negative-stock rejection are AC-4; idempotency_key makes offline resends safe.

-- admin-only helper (catalogue + money are Admin-maintained)
CREATE OR REPLACE FUNCTION fn_require_org_admin(p_org uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM memberships
   WHERE user_id = auth.uid() AND org_id = p_org AND role = 'admin' AND is_active;
  IF v IS NULL THEN RAISE EXCEPTION 'requires an active admin of org %', p_org USING errcode = '42501'; END IF;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION fn_require_org_admin(uuid) FROM anon, public;

-- ── catalogue (F-10.1) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_upsert_material(
  p_org uuid, p_name text, p_unit text,
  p_reorder_level numeric DEFAULT 10, p_standard_rate numeric DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM fn_require_org_admin(p_org);
  INSERT INTO materials_catalog (org_id, name, unit, reorder_level, standard_rate)
  VALUES (p_org, p_name, p_unit, p_reorder_level, p_standard_rate)
  ON CONFLICT (org_id, lower(name))
    DO UPDATE SET unit = EXCLUDED.unit, reorder_level = EXCLUDED.reorder_level, standard_rate = EXCLUDED.standard_rate
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_upsert_material(uuid, text, text, numeric, numeric) TO authenticated;

-- ── log a material transaction (IN / OUT) — the balance guardian ────────────
CREATE OR REPLACE FUNCTION fn_log_material_txn(
  p_id uuid, p_project uuid, p_material uuid, p_type txn_type, p_quantity numeric, p_idempotency_key text,
  p_unit_price numeric DEFAULT NULL, p_supplier_name text DEFAULT NULL, p_supplier_phone text DEFAULT NULL,
  p_delivery_note text DEFAULT NULL, p_budget_line uuid DEFAULT NULL,
  p_building uuid DEFAULT NULL, p_stage uuid DEFAULT NULL, p_batch uuid DEFAULT NULL,
  p_receipt_media uuid DEFAULT NULL, p_purpose text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_mem uuid; v_existing uuid; v_bal numeric; v_new numeric; v_reorder numeric;
BEGIN
  SELECT org_id INTO v_org FROM projects WHERE id = p_project;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown project %', p_project; END IF;
  v_mem := fn__membership_in(v_org);
  IF v_mem IS NULL THEN RAISE EXCEPTION 'not a member of the project''s org' USING errcode = '42501'; END IF;

  -- Idempotent: a resend with the same key does NOT double-count the balance.
  SELECT id INTO v_existing FROM material_transactions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  IF p_quantity <= 0 THEN RAISE EXCEPTION 'quantity must be > 0'; END IF;
  IF (SELECT org_id FROM materials_catalog WHERE id = p_material) IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'material % is not in the org', p_material USING errcode = '42501'; END IF;
  IF p_budget_line IS NOT NULL AND (SELECT project_id FROM budget_lines WHERE id = p_budget_line) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'budget line % is not in project %', p_budget_line, p_project; END IF;
  IF p_building IS NOT NULL AND (SELECT project_id FROM buildings WHERE id = p_building) IS DISTINCT FROM p_project THEN
    RAISE EXCEPTION 'building % is not in project %', p_building, p_project; END IF;
  IF p_type = 'OUT' AND p_building IS NULL THEN
    RAISE EXCEPTION 'an OUT must be tagged to a building (for requirement-vs-actual)'; END IF;

  -- Lock the balance row (create at 0 if absent), then adjust under lock — never
  -- recomputed on read (F-10.4).
  INSERT INTO material_balances (project_id, material_id, balance)
  VALUES (p_project, p_material, 0) ON CONFLICT DO NOTHING;
  SELECT balance INTO v_bal FROM material_balances
   WHERE project_id = p_project AND material_id = p_material FOR UPDATE;

  IF p_type = 'OUT' AND v_bal - p_quantity < 0 THEN
    RAISE EXCEPTION 'insufficient stock: balance % < % OUT (negative rejected)', v_bal, p_quantity;  -- F-10.5 / AC-4
  END IF;
  v_new := v_bal + CASE WHEN p_type = 'IN' THEN p_quantity ELSE -p_quantity END;

  INSERT INTO material_transactions (id, project_id, material_id, budget_line_id, type, quantity, unit_price,
                                     supplier_name, supplier_phone, delivery_note_no, receipt_media_id,
                                     building_id, stage_id, batch_id, created_by, idempotency_key)
  VALUES (p_id, p_project, p_material, p_budget_line, p_type, p_quantity, p_unit_price,
          p_supplier_name, p_supplier_phone, p_delivery_note, p_receipt_media,
          p_building, p_stage, p_batch, v_mem, p_idempotency_key);

  UPDATE material_balances SET balance = v_new, updated_at = NOW()
   WHERE project_id = p_project AND material_id = p_material;

  -- Reorder alert (F-10.6). BOQ-aware reorder advice is M6; this is the level trip.
  SELECT reorder_level INTO v_reorder FROM materials_catalog WHERE id = p_material;
  IF v_reorder IS NOT NULL AND v_new < v_reorder THEN
    INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
    VALUES (v_org, auth.uid(), 'reorder_alert', 'material_balances', p_material,
            jsonb_build_object('project', p_project, 'balance', v_new, 'reorder_level', v_reorder));
  END IF;
  RETURN p_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_log_material_txn(uuid,uuid,uuid,txn_type,numeric,text,numeric,text,text,text,uuid,uuid,uuid,uuid,uuid,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_log_material_txn(uuid,uuid,uuid,txn_type,numeric,text,numeric,text,text,text,uuid,uuid,uuid,uuid,uuid,text) TO authenticated;

-- ── void a transaction (Admin only) — reverse the balance under lock ────────
CREATE OR REPLACE FUNCTION fn_void_material_txn(p_txn uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r material_transactions%ROWTYPE; v_org uuid; v_bal numeric; v_new numeric;
BEGIN
  SELECT * INTO r FROM material_transactions WHERE id = p_txn;
  IF r.id IS NULL THEN RAISE EXCEPTION 'unknown transaction %', p_txn; END IF;
  IF r.voided_at IS NOT NULL THEN RAISE EXCEPTION 'already voided'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'void reason required'; END IF;
  SELECT org_id INTO v_org FROM projects WHERE id = r.project_id;
  PERFORM fn_require_org_admin(v_org);

  SELECT balance INTO v_bal FROM material_balances
   WHERE project_id = r.project_id AND material_id = r.material_id FOR UPDATE;
  -- Reversal: undo the original effect (IN → subtract, OUT → add back).
  v_new := v_bal + CASE WHEN r.type = 'IN' THEN -r.quantity ELSE r.quantity END;
  IF v_new < 0 THEN RAISE EXCEPTION 'cannot void: reversal would make balance negative'; END IF;

  UPDATE material_transactions SET voided_at = NOW(), voided_by = fn__membership_in(v_org), void_reason = p_reason
   WHERE id = p_txn;
  UPDATE material_balances SET balance = v_new, updated_at = NOW()
   WHERE project_id = r.project_id AND material_id = r.material_id;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, reason, after)
  VALUES (v_org, auth.uid(), 'void_material_txn', 'material_transactions', p_txn, p_reason,
          jsonb_build_object('balance', v_new));
END $$;
REVOKE EXECUTE ON FUNCTION fn_void_material_txn(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_void_material_txn(uuid, text) TO authenticated;

-- ── transfer between buildings/projects = paired OUT/IN (F-10.7) ────────────
CREATE OR REPLACE FUNCTION fn_transfer_material(
  p_out_id uuid, p_in_id uuid,
  p_from_project uuid, p_to_project uuid, p_material uuid, p_quantity numeric,
  p_from_building uuid, p_to_building uuid, p_idempotency_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM fn_log_material_txn(p_id=>p_out_id, p_project=>p_from_project, p_material=>p_material,
    p_type=>'OUT', p_quantity=>p_quantity, p_idempotency_key=>p_idempotency_key || ':out',
    p_building=>p_from_building, p_purpose=>'transfer out');
  PERFORM fn_log_material_txn(p_id=>p_in_id, p_project=>p_to_project, p_material=>p_material,
    p_type=>'IN', p_quantity=>p_quantity, p_idempotency_key=>p_idempotency_key || ':in',
    p_building=>p_to_building, p_purpose=>'transfer in');
  UPDATE material_transactions SET transfer_pair_id = p_in_id WHERE id = p_out_id;
  UPDATE material_transactions SET transfer_pair_id = p_out_id WHERE id = p_in_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_transfer_material(uuid,uuid,uuid,uuid,uuid,numeric,uuid,uuid,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_transfer_material(uuid,uuid,uuid,uuid,uuid,numeric,uuid,uuid,text) TO authenticated;
