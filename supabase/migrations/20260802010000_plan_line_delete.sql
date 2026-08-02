-- Delete a plan line (founder pilot Area 5): scenarios are editable inputs, so a
-- line (and, when it's the last line of a batch, that batch) must be removable.
-- plan_lines are planning INPUTS (not financial records), so a hard delete is fine.
-- Manager-gated, SECURITY DEFINER (Rule 1); the table keeps no client write policy.
CREATE OR REPLACE FUNCTION fn_delete_plan_line(p_plan uuid, p_line uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  v_org := fn__plan_org(p_plan);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  PERFORM fn_require_org_manager(v_org);
  DELETE FROM plan_lines WHERE id = p_line AND plan_id = p_plan;
END $$;
REVOKE EXECUTE ON FUNCTION fn_delete_plan_line(uuid, uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_delete_plan_line(uuid, uuid) TO authenticated;
