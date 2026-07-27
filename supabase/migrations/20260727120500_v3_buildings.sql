-- M0 · v3 phases / batches / buildings / stage progress (PRD.md §16.2)
-- A building is a copy of a recipe; a batch/phase is just a named grouping (§2.1).

CREATE TABLE phases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  sequence     INT,
  target_start DATE,
  target_end   DATE
);

CREATE TABLE batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  phase_id     UUID REFERENCES phases(id),
  name         VARCHAR(100) NOT NULL,
  sequence     INT,
  status       VARCHAR(20) DEFAULT 'planned',  -- planned | active | done
  started_at   TIMESTAMPTZ,
  trigger_note TEXT                             -- e.g. "start when Batch 1 reaches DPC" (informational)
);

CREATE TABLE buildings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  building_type_id UUID NOT NULL REFERENCES building_types(id) ON DELETE RESTRICT,
  code             VARCHAR(60) NOT NULL,   -- plot/house number
  phase_id         UUID REFERENCES phases(id),
  batch_id         UUID REFERENCES batches(id),
  current_stage_id UUID REFERENCES type_stages(id),
  status           VARCHAR(20) DEFAULT 'not_started',
  centroid         GEOGRAPHY(POINT,4326),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, code)
);
CREATE INDEX idx_buildings_project ON buildings(project_id);
CREATE INDEX idx_buildings_batch   ON buildings(batch_id);

CREATE TABLE building_stage_progress (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id  UUID NOT NULL REFERENCES buildings(id) ON DELETE CASCADE,
  stage_id     UUID NOT NULL REFERENCES type_stages(id),
  status       stage_status DEFAULT 'not_started',
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  approved_by  UUID REFERENCES memberships(id),
  UNIQUE (building_id, stage_id)
);
