-- M3 · A — Feasibility plan write path (§7.3). plans / plan_lines have no client write
-- policy (M0); writes go through the manager-gated SECURITY DEFINER functions below.
-- Only INPUTS are stored; results are always computed live (F-PLAN-6).

CREATE UNIQUE INDEX uq_plan_line ON plan_lines (plan_id, building_type_id, COALESCE(batch_hint, ''));

CREATE OR REPLACE FUNCTION fn_create_plan(
  p_org uuid, p_name text, p_mode plan_mode,
  p_project uuid DEFAULT NULL,
  p_available_cash numeric DEFAULT NULL,
  p_inflows jsonb DEFAULT NULL,
  p_assumptions jsonb DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  IF p_project IS NOT NULL AND (SELECT org_id FROM projects WHERE id = p_project) IS DISTINCT FROM p_org THEN
    RAISE EXCEPTION 'project % is not in org %', p_project, p_org;
  END IF;
  INSERT INTO plans (org_id, project_id, name, mode, available_cash, inflows, assumptions, created_by)
  VALUES (p_org, p_project, p_name, p_mode, p_available_cash,
          COALESCE(p_inflows, '[]'::jsonb), COALESCE(p_assumptions, '{}'::jsonb), v_mem)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_create_plan(uuid, text, plan_mode, uuid, numeric, jsonb, jsonb) TO authenticated;

-- helper: resolve a plan's org + require the caller manages it
CREATE OR REPLACE FUNCTION fn__plan_org(p_plan uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM plans WHERE id = p_plan;
$$;
REVOKE EXECUTE ON FUNCTION fn__plan_org(uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION fn_set_plan_line(
  p_plan uuid, p_building_type uuid, p_quantity int,
  p_target_stage uuid DEFAULT NULL, p_batch_hint text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  v_org := fn__plan_org(p_plan);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  PERFORM fn_require_org_manager(v_org);
  IF fn__type_org(p_building_type) IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'building type % is not in the plan''s org', p_building_type USING errcode = '42501';
  END IF;
  IF p_quantity < 1 THEN RAISE EXCEPTION 'quantity must be >= 1'; END IF;
  INSERT INTO plan_lines (plan_id, building_type_id, quantity, target_stage_id, batch_hint)
  VALUES (p_plan, p_building_type, p_quantity, p_target_stage, p_batch_hint)
  ON CONFLICT (plan_id, building_type_id, COALESCE(batch_hint, ''))
    DO UPDATE SET quantity = EXCLUDED.quantity, target_stage_id = EXCLUDED.target_stage_id
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_set_plan_line(uuid, uuid, int, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION fn_update_plan(
  p_plan uuid,
  p_available_cash numeric DEFAULT NULL,
  p_inflows jsonb DEFAULT NULL,
  p_assumptions jsonb DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := fn__plan_org(p_plan);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  PERFORM fn_require_org_manager(v_org);
  UPDATE plans SET
    available_cash = COALESCE(p_available_cash, available_cash),
    inflows        = COALESCE(p_inflows, inflows),
    assumptions    = COALESCE(p_assumptions, assumptions)
  WHERE id = p_plan;
END $$;
GRANT EXECUTE ON FUNCTION fn_update_plan(uuid, numeric, jsonb, jsonb) TO authenticated;
