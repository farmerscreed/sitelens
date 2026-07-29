-- Delete a single dated price entry (data-entry correction). Prices stay server-only
-- (Rule 1: material_prices has no client write policy) — this SECURITY DEFINER function
-- is the sole delete path, admin-only, and audited. Editing a price is still done by
-- fn_set_material_price (same effective_from = same-day correction via ON CONFLICT); this
-- is for removing a wrong entry outright.
CREATE OR REPLACE FUNCTION fn_delete_material_price(p_price_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   uuid;
  v_mat   uuid;
  v_price numeric;
  v_eff   date;
  v_mem   uuid;
BEGIN
  SELECT org_id, material_id, unit_price, effective_from
    INTO v_org, v_mat, v_price, v_eff
  FROM material_prices WHERE id = p_price_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'price entry not found';
  END IF;

  SELECT id INTO v_mem FROM memberships
   WHERE user_id = auth.uid() AND org_id = v_org AND role = 'admin' AND is_active;
  IF v_mem IS NULL THEN
    RAISE EXCEPTION 'only an active admin may delete prices' USING errcode = '42501';
  END IF;

  DELETE FROM material_prices WHERE id = p_price_id;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'delete_material_price', 'material_prices', p_price_id,
          jsonb_build_object('material_id', v_mat, 'unit_price', v_price, 'effective_from', v_eff));
END;
$$;
REVOKE EXECUTE ON FUNCTION fn_delete_material_price(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_delete_material_price(uuid) TO authenticated;
