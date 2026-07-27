-- M0 · v3 recipe library + dated price list (PRD.md §16.2)
-- Rule 4: quantities live on the recipe and carry NO price; prices are a
-- separate dated list; cost is always computed live.

-- ── RECIPE LIBRARY ──────────────────────────────
CREATE TABLE type_folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  parent_id  UUID REFERENCES type_folders(id),
  name       VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE building_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  folder_id         UUID REFERENCES type_folders(id),
  name              VARCHAR(150) NOT NULL,
  category          VARCHAR(50),                 -- terrace | duplex | g+3 | bungalow | custom
  description       TEXT,
  version           INT DEFAULT 1,
  parent_version_id UUID REFERENCES building_types(id),  -- version chain (F-TYPE-4)
  created_by        UUID REFERENCES memberships(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  archived_at       TIMESTAMPTZ
);
CREATE INDEX idx_bt_org ON building_types(org_id) WHERE archived_at IS NULL;

CREATE TABLE type_stages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  name             VARCHAR(80) NOT NULL,   -- Foundation | DPC | Lintel | Roof | Finishes
  sequence         INT NOT NULL,
  expected_days    INT,
  UNIQUE (building_type_id, sequence)
);

CREATE TABLE type_boq_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  stage_id         UUID REFERENCES type_stages(id),
  material_id      UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  quantity         NUMERIC(14,3) NOT NULL CHECK (quantity > 0),   -- quantity ONLY, no price
  unit             VARCHAR(20) NOT NULL,
  notes            TEXT
);
CREATE INDEX idx_boqitems_type ON type_boq_items(building_type_id);

CREATE TABLE type_stage_costs (             -- non-material costs per stage (F-PRICE-4)
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE CASCADE,
  stage_id         UUID REFERENCES type_stages(id),
  category         VARCHAR(50) NOT NULL,    -- labour | plant | other
  amount           NUMERIC(16,2) NOT NULL,
  notes            TEXT
);

-- ── PRICE LIST (dated) ──────────────────────────
CREATE TABLE material_prices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  material_id    UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  unit_price     NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  effective_from DATE NOT NULL,
  entered_by     UUID REFERENCES memberships(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
-- current price = latest effective_from <= today for (org, material)
CREATE INDEX idx_prices_lookup ON material_prices(org_id, material_id, effective_from DESC);
