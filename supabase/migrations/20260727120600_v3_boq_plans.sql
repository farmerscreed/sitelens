-- M0 · v3 BOQ import + mapping memory + feasibility plans (PRD.md §16.2)

-- ── BOQ IMPORT + MAPPING MEMORY ─────────────────
CREATE TABLE boq_imports (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  building_type_id UUID REFERENCES building_types(id),
  source_media_id  UUID REFERENCES media(id),   -- raw xlsx/pdf retained (F-BOQ-5)
  format           VARCHAR(10),                 -- xlsx | csv | pdf
  status           import_status DEFAULT 'uploaded',
  imported_by      UUID REFERENCES memberships(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE boq_import_rows (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id          UUID NOT NULL REFERENCES boq_imports(id) ON DELETE CASCADE,
  raw_text           TEXT,
  parsed_qty         NUMERIC(14,3),
  parsed_unit        VARCHAR(20),
  parsed_rate        NUMERIC(14,2),
  mapped_material_id UUID REFERENCES materials_catalog(id),
  confidence         NUMERIC(4,3),
  status             VARCHAR(20) DEFAULT 'proposed'  -- proposed | confirmed | rejected
);

CREATE TABLE material_aliases (              -- remember "this text = this material" (F-BOQ-3)
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_id UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE CASCADE,
  alias_text  VARCHAR(200) NOT NULL,
  UNIQUE (org_id, lower(alias_text))
);

-- ── FEASIBILITY PLANS ───────────────────────────
CREATE TABLE plans (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id     UUID REFERENCES projects(id),
  name           VARCHAR(120) NOT NULL,
  mode           plan_mode NOT NULL,
  available_cash NUMERIC(18,2),             -- for max_delivery mode
  inflows        JSONB,                     -- scheduled future inflows [{date, amount}]
  assumptions    JSONB,                     -- price overrides, batch schedule, triggers
  created_by     UUID REFERENCES memberships(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plan_lines (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id          UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  building_type_id UUID NOT NULL REFERENCES building_types(id),
  quantity         INT NOT NULL,
  target_stage_id  UUID REFERENCES type_stages(id),
  batch_hint       VARCHAR(60)
);
-- Plan RESULTS are computed live (never stored stale) so a price change
-- updates every saved scenario. Optionally cache a JSONB snapshot for comparison.
