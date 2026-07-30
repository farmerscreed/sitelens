-- Phase 2 · TRUE-COST core (BOQ_TRUE_COST_DESIGN §3.2–3.4, §4, §6, §7).
-- Work items hold the bill faithfully; assemblies turn work into materials+labour;
-- conversions bridge units (m3↔t, t↔pieces). Cost is ALWAYS computed live
-- (Rule 4); the QS rate is reference only. No client write policies (Rule 1);
-- everything an AI suggested stays a proposal until confirmed (Rule 3).

-- Latent bug fix (found by the Phase 2 tests): materials_catalog.id had no
-- DEFAULT, so fn_upsert_material failed for any NEW material (seed rows carry
-- explicit ids, which hid it). Same default the rest of the schema uses.
ALTER TABLE materials_catalog ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- ── Assemblies: reusable org-level mixes / build-ups ─────────────────────────
CREATE TABLE assemblies (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name              TEXT NOT NULL,
  unit              TEXT NOT NULL,                     -- output unit (m3, m2, nr)
  kind              TEXT NOT NULL DEFAULT 'custom'
                    CHECK (kind IN ('concrete','blockwork','mortar','render','screed','custom')),
  ratio             TEXT,                              -- "1:2:4" as read/entered
  dry_factor        NUMERIC NOT NULL DEFAULT 1.54,
  labour_rate       NUMERIC,                           -- ₦ per output unit (v1; dated ledger in Phase 3)
  plant_rate        NUMERIC,
  alternative_group TEXT,                              -- same output, different route (bought vs molded blocks)
  source            TEXT NOT NULL DEFAULT 'human',
  confidence        NUMERIC, model_id TEXT,
  verified_by       UUID REFERENCES memberships(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX uq_assemblies_name ON assemblies (org_id, lower(name));

CREATE TABLE assembly_components (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id    UUID NOT NULL REFERENCES assemblies(id) ON DELETE CASCADE,
  material_id    UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  qty_per_unit   NUMERIC NOT NULL CHECK (qty_per_unit > 0),
  unit           TEXT NOT NULL,
  waste_factor   NUMERIC NOT NULL DEFAULT 1.05 CHECK (waste_factor >= 1),
  component_kind TEXT NOT NULL DEFAULT 'consumable' CHECK (component_kind IN ('consumable','reusable')),
  reuse_count    NUMERIC CHECK (reuse_count IS NULL OR reuse_count >= 1),
  UNIQUE (assembly_id, material_id)
);

-- ── Unit conversions (m3↔t densities, rebar t↔12m pieces) ────────────────────
CREATE TABLE material_conversions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE CASCADE,
  from_unit   TEXT NOT NULL,
  to_unit     TEXT NOT NULL,
  factor      NUMERIC NOT NULL CHECK (factor > 0),     -- qty[to] = qty[from] × factor
  source      TEXT NOT NULL DEFAULT 'standard',
  verified_by UUID REFERENCES memberships(id),
  UNIQUE (material_id, from_unit, to_unit)
);

-- ── Work items: the bill's measured lines, faithfully (§3.2) ─────────────────
CREATE TABLE type_work_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  stage_id         UUID REFERENCES type_stages(id),
  source_row_id    UUID REFERENCES boq_import_rows(id) ON DELETE SET NULL,
  element_name     TEXT,
  section_name     TEXT,
  boq_ref          TEXT,
  description      TEXT NOT NULL,
  quantity         NUMERIC,
  unit             TEXT,
  kind             work_item_kind NOT NULL DEFAULT 'other',
  assembly_id      UUID REFERENCES assemblies(id),
  material_id      UUID REFERENCES materials_catalog(id),
  boq_rate         NUMERIC,          -- QS all-in rate: REFERENCE ONLY, never live cost
  is_priced        BOOLEAN NOT NULL DEFAULT true,
  is_provisional   BOOLEAN NOT NULL DEFAULT false,
  source           TEXT, confidence NUMERIC, model_id TEXT,
  verified_by      UUID REFERENCES memberships(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_work_items_type ON type_work_items (building_type_id);
-- Idempotency: one work item per confirmed staging row.
CREATE UNIQUE INDEX uq_work_item_source ON type_work_items (source_row_id)
  WHERE source_row_id IS NOT NULL;

-- ── RLS: SELECT-only, org-scoped; writes via server functions (Rule 1) ───────
ALTER TABLE assemblies           ENABLE ROW LEVEL SECURITY;
ALTER TABLE assembly_components  ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE type_work_items      ENABLE ROW LEVEL SECURITY;
CREATE POLICY assemblies_select ON assemblies FOR SELECT
  USING (org_id = current_org_id());
CREATE POLICY assembly_components_select ON assembly_components FOR SELECT
  USING (EXISTS (SELECT 1 FROM assemblies a
                 WHERE a.id = assembly_components.assembly_id AND a.org_id = current_org_id()));
CREATE POLICY material_conversions_select ON material_conversions FOR SELECT
  USING (org_id = current_org_id());
CREATE POLICY type_work_items_select ON type_work_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM building_types bt
                 WHERE bt.id = type_work_items.building_type_id AND bt.org_id = current_org_id()));
GRANT SELECT ON assemblies, assembly_components, material_conversions, type_work_items TO authenticated;

-- ── fn_upsert_assembly: manager-gated; components validated; audited ─────────
-- p_components: [{material_id, qty_per_unit, unit, waste_factor?, component_kind?, reuse_count?}]
CREATE OR REPLACE FUNCTION fn_upsert_assembly(
  p_org uuid, p_name text, p_unit text, p_kind text, p_ratio text,
  p_dry_factor numeric, p_labour_rate numeric, p_plant_rate numeric,
  p_alt_group text, p_components jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid; c jsonb;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  INSERT INTO assemblies (org_id, name, unit, kind, ratio, dry_factor, labour_rate,
                          plant_rate, alternative_group, verified_by)
  VALUES (p_org, p_name, p_unit, COALESCE(p_kind,'custom'), p_ratio,
          COALESCE(p_dry_factor, 1.54), p_labour_rate, p_plant_rate, p_alt_group, v_mem)
  ON CONFLICT (org_id, lower(name)) DO UPDATE
    SET unit = EXCLUDED.unit, kind = EXCLUDED.kind, ratio = EXCLUDED.ratio,
        dry_factor = EXCLUDED.dry_factor, labour_rate = EXCLUDED.labour_rate,
        plant_rate = EXCLUDED.plant_rate, alternative_group = EXCLUDED.alternative_group,
        verified_by = EXCLUDED.verified_by
  RETURNING id INTO v_id;

  DELETE FROM assembly_components WHERE assembly_id = v_id;
  FOR c IN SELECT jsonb_array_elements(COALESCE(p_components, '[]'::jsonb)) LOOP
    IF NOT EXISTS (SELECT 1 FROM materials_catalog
                   WHERE id = (c->>'material_id')::uuid AND org_id = p_org) THEN
      RAISE EXCEPTION 'component material % is not in the org', c->>'material_id' USING errcode = '42501';
    END IF;
    INSERT INTO assembly_components
      (assembly_id, material_id, qty_per_unit, unit, waste_factor, component_kind, reuse_count)
    VALUES (v_id, (c->>'material_id')::uuid, (c->>'qty_per_unit')::numeric, c->>'unit',
            COALESCE(NULLIF(c->>'waste_factor','')::numeric, 1.05),
            COALESCE(NULLIF(c->>'component_kind',''), 'consumable'),
            NULLIF(c->>'reuse_count','')::numeric);
  END LOOP;

  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (p_org, auth.uid(), 'upsert_assembly', 'assemblies', v_id,
          jsonb_build_object('name', p_name, 'components', p_components));
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_upsert_assembly(uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_upsert_assembly(uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb) TO authenticated;

-- ── fn_set_material_conversion ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_material_conversion(
  p_org uuid, p_material uuid, p_from text, p_to text, p_factor numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  IF NOT EXISTS (SELECT 1 FROM materials_catalog WHERE id = p_material AND org_id = p_org) THEN
    RAISE EXCEPTION 'material % is not in the org', p_material USING errcode = '42501';
  END IF;
  INSERT INTO material_conversions (org_id, material_id, from_unit, to_unit, factor, verified_by)
  VALUES (p_org, p_material, p_from, p_to, p_factor, v_mem)
  ON CONFLICT (material_id, from_unit, to_unit)
    DO UPDATE SET factor = EXCLUDED.factor, verified_by = EXCLUDED.verified_by
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE EXECUTE ON FUNCTION fn_set_material_conversion(uuid,uuid,text,text,numeric) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_material_conversion(uuid,uuid,text,text,numeric) TO authenticated;

-- ── unit bridge: qty in from_unit → qty in the material's stock unit ─────────
CREATE OR REPLACE FUNCTION fn_convert_to_material_unit(p_material uuid, p_qty numeric, p_from text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_qty IS NULL THEN NULL
    WHEN p_from IS NULL OR lower(p_from) = lower(m.unit) THEN p_qty
    ELSE p_qty * (SELECT factor FROM material_conversions
                   WHERE material_id = p_material
                     AND lower(from_unit) = lower(p_from)
                     AND lower(to_unit) = lower(m.unit) LIMIT 1)
  END
  FROM materials_catalog m WHERE m.id = p_material;
$$;
GRANT EXECUTE ON FUNCTION fn_convert_to_material_unit(uuid, numeric, text) TO authenticated;

-- ── live unit cost of a work item (Rule 4: always computed, never stored) ────
CREATE OR REPLACE FUNCTION fn_work_item_unit_cost(p_work_item uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE wi type_work_items%ROWTYPE; v numeric; v_org uuid;
BEGIN
  SELECT * INTO wi FROM type_work_items WHERE id = p_work_item;
  IF wi.id IS NULL THEN RETURN NULL; END IF;
  SELECT org_id INTO v_org FROM building_types WHERE id = wi.building_type_id;

  IF wi.kind = 'material_supply' AND wi.material_id IS NOT NULL THEN
    -- price per stock unit × units per work-item unit
    RETURN current_price(v_org, wi.material_id) * fn_convert_to_material_unit(wi.material_id, 1, wi.unit);
  ELSIF wi.kind = 'composite' AND wi.assembly_id IS NOT NULL THEN
    SELECT COALESCE(SUM(
             CASE WHEN ac.component_kind = 'reusable'
                  THEN ac.qty_per_unit / GREATEST(COALESCE(ac.reuse_count, 1), 1)
                  ELSE ac.qty_per_unit * ac.waste_factor END
             * current_price(v_org, ac.material_id)
             * COALESCE(fn_convert_to_material_unit(ac.material_id, 1, ac.unit), 1)), 0)
           + COALESCE(a.labour_rate, 0) + COALESCE(a.plant_rate, 0)
      INTO v
      FROM assemblies a LEFT JOIN assembly_components ac ON ac.assembly_id = a.id
     WHERE a.id = wi.assembly_id
     GROUP BY a.labour_rate, a.plant_rate;
    RETURN v;
  ELSIF wi.kind IN ('labour','plant') AND wi.assembly_id IS NOT NULL THEN
    SELECT COALESCE(a.labour_rate, 0) + COALESCE(a.plant_rate, 0) INTO v
      FROM assemblies a WHERE a.id = wi.assembly_id;
    RETURN v;
  END IF;
  RETURN NULL;  -- not costable yet (unpriced/provisional/unmapped) — never guess
END $$;
GRANT EXECUTE ON FUNCTION fn_work_item_unit_cost(uuid) TO authenticated;

-- Work items with live cost + BOQ reference side by side (variance visible).
CREATE VIEW work_item_cost WITH (security_invoker = true) AS
SELECT wi.*,
       fn_work_item_unit_cost(wi.id)                               AS unit_cost_live,
       wi.quantity * fn_work_item_unit_cost(wi.id)                 AS cost_live,
       wi.quantity * wi.boq_rate                                   AS boq_amount
FROM type_work_items wi;
GRANT SELECT ON work_item_cost TO authenticated;

-- Raw-material take-off per type/stage: direct supply + composite expansion,
-- in each material's own stock unit (waste and formwork-reuse applied).
CREATE VIEW type_material_takeoff WITH (security_invoker = true) AS
SELECT building_type_id, stage_id, material_id, SUM(qty_required) AS qty_required
FROM (
  SELECT wi.building_type_id, wi.stage_id, wi.material_id,
         fn_convert_to_material_unit(wi.material_id, wi.quantity, wi.unit) AS qty_required
  FROM type_work_items wi
  WHERE wi.kind = 'material_supply' AND wi.material_id IS NOT NULL
  UNION ALL
  SELECT wi.building_type_id, wi.stage_id, ac.material_id,
         fn_convert_to_material_unit(
           ac.material_id,
           wi.quantity * CASE WHEN ac.component_kind = 'reusable'
                              THEN ac.qty_per_unit / GREATEST(COALESCE(ac.reuse_count,1),1)
                              ELSE ac.qty_per_unit * ac.waste_factor END,
           ac.unit)
  FROM type_work_items wi
  JOIN assembly_components ac ON ac.assembly_id = wi.assembly_id
  WHERE wi.kind = 'composite'
) t
WHERE qty_required IS NOT NULL
GROUP BY building_type_id, stage_id, material_id;
GRANT SELECT ON type_material_takeoff TO authenticated;

-- ── fn_confirm_boq_import_v2: staged rows → work items (idempotent) ──────────
-- p_items: [{row_id, stage_id?, kind, quantity, unit, material_id?, assembly_id?,
--            boq_rate?, description?}]. material_supply rows ALSO feed the classic
-- recipe (type_boq_items) so cost/usage/reorder engines keep working — with the
-- Phase-0 summed, idempotent semantics.
CREATE OR REPLACE FUNCTION fn_confirm_boq_import_v2(p_import uuid, p_items jsonb)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_type uuid; c jsonb; n int := 0; v_mem uuid;
  r boq_import_rows%ROWTYPE; v_stage uuid; v_kind work_item_kind;
  v_material uuid; v_assembly uuid; v_qty numeric; v_unit text; v_rate numeric;
BEGIN
  SELECT org_id, building_type_id INTO v_org, v_type FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  IF v_type IS NULL THEN RAISE EXCEPTION 'import % has no target building type', p_import; END IF;
  v_mem := fn_require_org_manager(v_org);

  FOR c IN SELECT jsonb_array_elements(p_items) LOOP
    SELECT * INTO r FROM boq_import_rows
     WHERE id = (c->>'row_id')::uuid AND import_id = p_import;
    IF r.id IS NULL THEN RAISE EXCEPTION 'row % is not in import %', c->>'row_id', p_import; END IF;
    IF r.row_kind <> 'item' THEN RAISE EXCEPTION 'row % is a %, not an item', r.id, r.row_kind; END IF;

    v_stage    := NULLIF(c->>'stage_id','')::uuid;
    v_kind     := COALESCE(NULLIF(c->>'kind','')::work_item_kind, r.suggested_kind, 'other');
    v_material := NULLIF(c->>'material_id','')::uuid;
    v_assembly := NULLIF(c->>'assembly_id','')::uuid;
    v_qty      := COALESCE(NULLIF(c->>'quantity','')::numeric, r.parsed_qty);
    v_unit     := COALESCE(NULLIF(c->>'unit',''), r.unit_normalized, r.parsed_unit);
    v_rate     := COALESCE(NULLIF(c->>'boq_rate','')::numeric, r.parsed_rate);

    IF v_stage IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM type_stages WHERE id = v_stage AND building_type_id = v_type) THEN
      RAISE EXCEPTION 'stage % is not in type %', v_stage, v_type;
    END IF;
    IF v_material IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM materials_catalog WHERE id = v_material AND org_id = v_org) THEN
      RAISE EXCEPTION 'material % is not in the org', v_material USING errcode = '42501';
    END IF;
    IF v_assembly IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM assemblies WHERE id = v_assembly AND org_id = v_org) THEN
      RAISE EXCEPTION 'assembly % is not in the org', v_assembly USING errcode = '42501';
    END IF;

    INSERT INTO type_work_items
      (building_type_id, stage_id, source_row_id, element_name, section_name, boq_ref,
       description, quantity, unit, kind, assembly_id, material_id, boq_rate,
       is_priced, is_provisional, source, confidence, model_id, verified_by)
    VALUES
      (v_type, v_stage, r.id, r.section_path[1], r.section_path[2], r.boq_ref,
       COALESCE(NULLIF(c->>'description',''), r.resolved_text, r.raw_text),
       v_qty, v_unit, v_kind, v_assembly, v_material, v_rate,
       r.is_priced, r.is_provisional, 'boq_import', r.confidence, r.model_id, v_mem)
    ON CONFLICT (source_row_id) WHERE source_row_id IS NOT NULL
      DO UPDATE SET stage_id = EXCLUDED.stage_id, quantity = EXCLUDED.quantity,
        unit = EXCLUDED.unit, kind = EXCLUDED.kind, assembly_id = EXCLUDED.assembly_id,
        material_id = EXCLUDED.material_id, boq_rate = EXCLUDED.boq_rate,
        description = EXCLUDED.description, verified_by = EXCLUDED.verified_by;

    -- Alias memory for mapped materials (same as v1 confirm).
    IF v_material IS NOT NULL AND length(trim(r.raw_text)) > 0 THEN
      INSERT INTO material_aliases (org_id, material_id, alias_text)
      VALUES (v_org, v_material, r.raw_text)
      ON CONFLICT (org_id, lower(alias_text)) DO UPDATE SET material_id = EXCLUDED.material_id;
    END IF;
    UPDATE boq_import_rows SET status = 'confirmed', mapped_material_id = v_material WHERE id = r.id;
    n := n + 1;
  END LOOP;

  -- material_supply lines also land in the classic recipe (summed, idempotent —
  -- Phase 0 semantics; unit mixing rejected there applies here too).
  INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit)
  SELECT v_type, wi.stage_id, wi.material_id, SUM(wi.quantity), MAX(wi.unit)
    FROM type_work_items wi
    JOIN boq_import_rows br ON br.id = wi.source_row_id
   WHERE br.import_id = p_import AND wi.kind = 'material_supply'
     AND wi.material_id IS NOT NULL AND wi.quantity IS NOT NULL
   GROUP BY wi.stage_id, wi.material_id
  ON CONFLICT (building_type_id, stage_id, material_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit;

  UPDATE boq_imports SET status = 'confirmed' WHERE id = p_import;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'confirm_boq_import_v2', 'boq_imports', p_import,
          jsonb_build_object('work_items', n));
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION fn_confirm_boq_import_v2(uuid, jsonb) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_confirm_boq_import_v2(uuid, jsonb) TO authenticated;

-- ── §7 guardrail: price proposals ONLY from material_supply rows ─────────────
-- Composite/labour/plant BOQ rates are ALL-IN (labour+plant+OH&P) and must never
-- reach material_prices. Even supply rates are proposals a human accepts
-- (accept → fn_set_material_price), labelled as all-in BOQ rates.
CREATE OR REPLACE FUNCTION fn_propose_prices_from_import(p_import uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; r record; n int := 0;
BEGIN
  SELECT org_id INTO v_org FROM boq_imports WHERE id = p_import;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown import %', p_import; END IF;
  PERFORM fn_require_org_manager(v_org);

  FOR r IN
    SELECT br.id, br.mapped_material_id, br.parsed_rate, br.unit_normalized,
           br.parsed_unit, br.raw_text, br.confidence
      FROM boq_import_rows br
     WHERE br.import_id = p_import
       AND br.row_kind = 'item'
       AND br.suggested_kind = 'material_supply'      -- THE guardrail
       AND br.mapped_material_id IS NOT NULL
       AND br.parsed_rate IS NOT NULL AND br.parsed_rate > 0
  LOOP
    PERFORM fn_record_inference(
      v_org, 'price_proposal',
      jsonb_build_object(
        'material_id', r.mapped_material_id,
        'proposed_price', r.parsed_rate,
        'unit', COALESCE(r.unit_normalized, r.parsed_unit),
        'from_text', r.raw_text,
        'import_id', p_import,
        'current_price', current_price(v_org, r.mapped_material_id),
        'note', 'All-in BOQ rate (may include delivery/labour) — compare before accepting'),
      NULL, NULL, r.id, NULL, r.confidence, NULL);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION fn_propose_prices_from_import(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_propose_prices_from_import(uuid) TO authenticated;
