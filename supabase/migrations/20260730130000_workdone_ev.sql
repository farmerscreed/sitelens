-- Phase 3 · WORK-DONE + EARNED VALUE (BOQ_TRUE_COST_DESIGN §3.3, §3.5, §3.6, §4).
-- Dated labour rates (same discipline as material_prices) and per-building
-- work-done, driving earned value = qty_done × live unit cost. Append-only,
-- idempotent, server-function writes only (Rules 1/2/4).

-- ── Dated labour rates ───────────────────────────────────────────────────────
CREATE TABLE labour_rates (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  assembly_id    UUID REFERENCES assemblies(id) ON DELETE CASCADE,
  work_code      TEXT,                       -- free code when not assembly-tied
  unit           TEXT NOT NULL,
  rate           NUMERIC NOT NULL CHECK (rate >= 0),
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  entered_by     UUID REFERENCES memberships(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (assembly_id IS NOT NULL OR work_code IS NOT NULL)
);
CREATE UNIQUE INDEX uq_labour_rates_dated
  ON labour_rates (org_id, assembly_id, work_code, effective_from) NULLS NOT DISTINCT;
ALTER TABLE labour_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY labour_rates_select ON labour_rates FOR SELECT
  USING (org_id = current_org_id());
GRANT SELECT ON labour_rates TO authenticated;

CREATE OR REPLACE FUNCTION fn_set_labour_rate(
  p_org uuid, p_assembly uuid, p_work_code text, p_unit text, p_rate numeric,
  p_effective_from date DEFAULT CURRENT_DATE)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  IF p_assembly IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM assemblies WHERE id = p_assembly AND org_id = p_org) THEN
    RAISE EXCEPTION 'assembly % is not in the org', p_assembly USING errcode = '42501';
  END IF;
  INSERT INTO labour_rates (org_id, assembly_id, work_code, unit, rate, effective_from, entered_by)
  VALUES (p_org, p_assembly, p_work_code, p_unit, p_rate, p_effective_from, v_mem)
  ON CONFLICT (org_id, assembly_id, work_code, effective_from)
    DO UPDATE SET rate = EXCLUDED.rate, unit = EXCLUDED.unit, entered_by = EXCLUDED.entered_by
  RETURNING id INTO v_id;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (p_org, auth.uid(), 'set_labour_rate', 'labour_rates', v_id,
          jsonb_build_object('assembly_id', p_assembly, 'work_code', p_work_code, 'rate', p_rate));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_set_labour_rate(uuid,uuid,text,text,numeric,date) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_labour_rate(uuid,uuid,text,text,numeric,date) TO authenticated;

CREATE OR REPLACE FUNCTION fn_current_labour_rate(p_org uuid, p_assembly uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT rate FROM labour_rates
   WHERE org_id = p_org AND assembly_id = p_assembly AND effective_from <= CURRENT_DATE
   ORDER BY effective_from DESC LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION fn_current_labour_rate(uuid, uuid) TO authenticated;

-- Live cost now prefers the DATED labour rate over the assembly's static one.
CREATE OR REPLACE FUNCTION fn_work_item_unit_cost(p_work_item uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE wi type_work_items%ROWTYPE; v numeric; v_org uuid;
BEGIN
  SELECT * INTO wi FROM type_work_items WHERE id = p_work_item;
  IF wi.id IS NULL THEN RETURN NULL; END IF;
  SELECT org_id INTO v_org FROM building_types WHERE id = wi.building_type_id;

  IF wi.kind = 'material_supply' AND wi.material_id IS NOT NULL THEN
    RETURN current_price(v_org, wi.material_id) * fn_convert_to_material_unit(wi.material_id, 1, wi.unit);
  ELSIF wi.kind = 'composite' AND wi.assembly_id IS NOT NULL THEN
    SELECT COALESCE(SUM(
             CASE WHEN ac.component_kind = 'reusable'
                  THEN ac.qty_per_unit / GREATEST(COALESCE(ac.reuse_count, 1), 1)
                  ELSE ac.qty_per_unit * ac.waste_factor END
             * current_price(v_org, ac.material_id)
             * COALESCE(fn_convert_to_material_unit(ac.material_id, 1, ac.unit), 1)), 0)
           + COALESCE(fn_current_labour_rate(v_org, a.id), a.labour_rate, 0)
           + COALESCE(a.plant_rate, 0)
      INTO v
      FROM assemblies a LEFT JOIN assembly_components ac ON ac.assembly_id = a.id
     WHERE a.id = wi.assembly_id
     GROUP BY a.id, a.labour_rate, a.plant_rate;
    RETURN v;
  ELSIF wi.kind IN ('labour','plant') AND wi.assembly_id IS NOT NULL THEN
    SELECT COALESCE(fn_current_labour_rate(v_org, a.id), a.labour_rate, 0) + COALESCE(a.plant_rate, 0)
      INTO v FROM assemblies a WHERE a.id = wi.assembly_id;
    RETURN v;
  END IF;
  RETURN NULL;
END $$;

-- ── Work done per building / work item (append-only, idempotent) ─────────────
CREATE TABLE building_work_actuals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id     UUID NOT NULL REFERENCES buildings(id) ON DELETE RESTRICT,
  work_item_id    UUID NOT NULL REFERENCES type_work_items(id) ON DELETE RESTRICT,
  qty_done        NUMERIC NOT NULL CHECK (qty_done >= 0),  -- cumulative as of as_of
  as_of           DATE NOT NULL DEFAULT CURRENT_DATE,
  note            TEXT,
  source          TEXT NOT NULL DEFAULT 'human',
  confidence      NUMERIC,
  verified_by     UUID REFERENCES memberships(id),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_bwa_building ON building_work_actuals (building_id, work_item_id, as_of);
ALTER TABLE building_work_actuals ENABLE ROW LEVEL SECURITY;
CREATE POLICY building_work_actuals_select ON building_work_actuals FOR SELECT
  USING (EXISTS (SELECT 1 FROM buildings b
                 WHERE b.id = building_work_actuals.building_id
                   AND b.org_id = current_org_id() AND has_project_access(b.project_id)));
GRANT SELECT ON building_work_actuals TO authenticated;

CREATE OR REPLACE FUNCTION fn_log_work_done(
  p_building uuid, p_work_item uuid, p_qty_done numeric,
  p_idempotency_key text, p_as_of date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_type uuid; v_mem uuid; v_id uuid; v_qty numeric;
BEGIN
  SELECT b.org_id, b.building_type_id INTO v_org, v_type FROM buildings b WHERE b.id = p_building;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building %', p_building; END IF;
  v_mem := fn_require_org_manager(v_org);
  SELECT quantity INTO v_qty FROM type_work_items
   WHERE id = p_work_item AND building_type_id = v_type;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'work item % is not in building''s type', p_work_item USING errcode = '42501';
  END IF;
  IF v_qty IS NOT NULL AND p_qty_done > v_qty * 1.5 THEN
    RAISE EXCEPTION 'qty_done % is more than 150%% of the designed quantity % — check the figure', p_qty_done, v_qty;
  END IF;
  -- Idempotent: a retry with the same key is a no-op returning the same row.
  INSERT INTO building_work_actuals
    (building_id, work_item_id, qty_done, as_of, note, verified_by, idempotency_key)
  VALUES (p_building, p_work_item, p_qty_done, p_as_of, p_note, v_mem, p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM building_work_actuals WHERE idempotency_key = p_idempotency_key;
  END IF;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_log_work_done(uuid,uuid,numeric,text,date,text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_log_work_done(uuid,uuid,numeric,text,date,text) TO authenticated;

-- ── Earned value: latest cumulative qty_done × LIVE unit cost ────────────────
CREATE VIEW building_work_ev WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.project_id, wi.id AS work_item_id, wi.stage_id,
       wi.element_name, wi.description, wi.kind, wi.quantity AS qty_planned, wi.unit,
       act.qty_done,
       fn_work_item_unit_cost(wi.id)                          AS unit_cost_live,
       wi.quantity   * fn_work_item_unit_cost(wi.id)          AS planned_value,
       act.qty_done  * fn_work_item_unit_cost(wi.id)          AS earned_value,
       wi.quantity   * wi.boq_rate                            AS boq_amount
FROM buildings b
JOIN type_work_items wi ON wi.building_type_id = b.building_type_id
LEFT JOIN LATERAL (
  SELECT a.qty_done FROM building_work_actuals a
   WHERE a.building_id = b.id AND a.work_item_id = wi.id
   ORDER BY a.as_of DESC, a.created_at DESC LIMIT 1
) act ON true;
GRANT SELECT ON building_work_ev TO authenticated;
