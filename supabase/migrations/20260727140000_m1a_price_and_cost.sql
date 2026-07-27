-- M1 · A — Price write path (Rule 1) + live cost computation (Rule 4).
--
-- Rule 1: no client is trusted with prices. material_prices has NO client write
-- policy (M0); the ONLY write path is fn_set_material_price below (SECURITY DEFINER,
-- admin-gated, audited, append-only/dated).
-- Rule 4: cost is quantity × current_price, computed LIVE, never frozen.

-- One price row per (org, material, effective date). A same-date call is a same-day
-- correction (upsert); it never rewrites a DIFFERENT date's history. Also makes
-- current_price() deterministic. (DECISIONS #15)
CREATE UNIQUE INDEX uq_material_prices_dated
  ON material_prices (org_id, material_id, effective_from);

-- ── fn_set_material_price — the only write path into the price list ──────────
CREATE OR REPLACE FUNCTION fn_set_material_price(
  p_org            uuid,
  p_material       uuid,
  p_unit_price     numeric,
  p_effective_from date DEFAULT CURRENT_DATE
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mem      uuid;
  v_price_id uuid;
BEGIN
  IF p_unit_price IS NULL OR p_unit_price < 0 THEN
    RAISE EXCEPTION 'unit_price must be >= 0';
  END IF;

  -- Caller must be an active ADMIN of the org (F-PRICE-1).
  SELECT id INTO v_mem
  FROM memberships
  WHERE user_id = auth.uid() AND org_id = p_org AND role = 'admin' AND is_active;
  IF v_mem IS NULL THEN
    RAISE EXCEPTION 'only an active admin of org % may set prices', p_org
      USING errcode = '42501';
  END IF;

  -- The material must belong to that org.
  IF NOT EXISTS (SELECT 1 FROM materials_catalog WHERE id = p_material AND org_id = p_org) THEN
    RAISE EXCEPTION 'material % is not in org %', p_material, p_org
      USING errcode = '42501';
  END IF;

  -- Dated append (F-PRICE-2). Same-date = same-day correction, not a history rewrite.
  INSERT INTO material_prices (org_id, material_id, unit_price, effective_from, entered_by)
  VALUES (p_org, p_material, p_unit_price, p_effective_from, v_mem)
  ON CONFLICT (org_id, material_id, effective_from)
    DO UPDATE SET unit_price = EXCLUDED.unit_price,
                  entered_by = EXCLUDED.entered_by,
                  created_at = NOW()
  RETURNING id INTO v_price_id;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (p_org, auth.uid(), 'set_material_price', 'material_prices', v_price_id,
          jsonb_build_object('material_id', p_material,
                             'unit_price', p_unit_price,
                             'effective_from', p_effective_from));

  RETURN v_price_id;
END;
$$;
REVOKE EXECUTE ON FUNCTION fn_set_material_price(uuid, uuid, numeric, date) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_material_price(uuid, uuid, numeric, date) TO authenticated;

-- ── fn_type_cost — live cost of a building type (Rule 4, F-PRICE-3/4) ────────
-- materials  = Σ type_boq_items.quantity × current_price(org, material)  (live)
-- nonmaterial= Σ type_stage_costs.amount
-- Computed live so one price change instantly re-costs every type/building/plan.
-- SECURITY INVOKER: respects RLS (caller must have the type's org active).
CREATE OR REPLACE FUNCTION fn_type_cost(p_type uuid)
RETURNS TABLE (materials_cost numeric, nonmaterial_cost numeric, total_cost numeric)
LANGUAGE sql
STABLE
AS $$
  WITH t AS (SELECT org_id FROM building_types WHERE id = p_type),
  mat AS (
    SELECT COALESCE(SUM(bi.quantity * COALESCE(current_price((SELECT org_id FROM t), bi.material_id), 0)), 0) AS c
    FROM type_boq_items bi
    WHERE bi.building_type_id = p_type
  ),
  nm AS (
    SELECT COALESCE(SUM(sc.amount), 0) AS c
    FROM type_stage_costs sc
    WHERE sc.building_type_id = p_type
  )
  SELECT mat.c, nm.c, mat.c + nm.c FROM mat, nm;
$$;
REVOKE EXECUTE ON FUNCTION fn_type_cost(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_type_cost(uuid) TO authenticated;
