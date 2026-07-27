-- M0 · v2 domain tables (SiteLens_PRD_v2.md §10.2), transcribed unchanged.
-- v3 later ALTERs material_transactions / expenses / daily_reports (see _v3_alters).

-- ─────────────── BUDGET ───────────────
CREATE TABLE budget_lines (
  id              UUID PRIMARY KEY,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  cost_code       VARCHAR(20) NOT NULL,
  name            VARCHAR(150) NOT NULL,
  budgeted_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
  sort_order      INT DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, cost_code)
);

-- ─────────────── TASKS ───────────────
CREATE TABLE tasks (
  id               UUID PRIMARY KEY,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id   UUID REFERENCES tasks(id) ON DELETE CASCADE,
  budget_line_id   UUID REFERENCES budget_lines(id),
  title            VARCHAR(200) NOT NULL,
  description      TEXT,
  assigned_to      UUID REFERENCES memberships(id),
  status           task_status DEFAULT 'not_started',
  blocked_reason   TEXT,
  progress_percent INT DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  weight           NUMERIC(6,2) DEFAULT 1,
  start_date       DATE,
  due_date         DATE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);
CREATE INDEX idx_tasks_project ON tasks(project_id);
CREATE INDEX idx_tasks_parent  ON tasks(parent_task_id);

-- ─────────────── MEDIA (unified) ───────────────
CREATE TABLE media (
  id              UUID PRIMARY KEY,
  org_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id      UUID REFERENCES projects(id) ON DELETE RESTRICT,
  key_thumb       TEXT,
  key_display     TEXT,
  key_original    TEXT,
  mime_type       VARCHAR(50),
  bytes_original  BIGINT,
  captured_at     TIMESTAMPTZ,                -- device clock
  received_at     TIMESTAMPTZ DEFAULT NOW(),  -- server clock, authoritative
  captured_point  GEOGRAPHY(POINT,4326),
  gps_accuracy_m  NUMERIC(6,2),
  within_geofence BOOLEAN,
  mock_location   BOOLEAN DEFAULT FALSE,      -- Android mock-provider flag
  clock_skew_s    INT,
  phash           BIT(64),                    -- AI-1 duplicate detection
  duplicate_of    UUID REFERENCES media(id),
  quality_score   NUMERIC(3,2),               -- AI-3
  exif            JSONB,
  uploaded_by     UUID REFERENCES memberships(id),
  UNIQUE (id)
);
CREATE INDEX idx_media_project   ON media(project_id, received_at DESC);
CREATE INDEX idx_media_phash     ON media(phash);
CREATE INDEX idx_media_flags     ON media(project_id)
  WHERE within_geofence = FALSE OR mock_location = TRUE OR duplicate_of IS NOT NULL;

-- ─────────────── DAILY REPORTS ───────────────
CREATE TABLE daily_reports (
  id                    UUID PRIMARY KEY,
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  report_date           DATE NOT NULL,
  version               INT DEFAULT 1,
  submitted_by          UUID REFERENCES memberships(id),
  work_summary          TEXT NOT NULL,
  weather               VARCHAR(50),
  issues                TEXT,
  status                approval_status DEFAULT 'pending',
  approved_by           UUID REFERENCES memberships(id),
  approved_at           TIMESTAMPTZ,
  rejection_reason      TEXT,
  is_offline_submission BOOLEAN DEFAULT FALSE,
  submitted_point       GEOGRAPHY(POINT,4326),
  device_captured_at    TIMESTAMPTZ,
  submitted_at          TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key       TEXT UNIQUE NOT NULL,
  UNIQUE (project_id, report_date, version)
);
CREATE INDEX idx_reports_project_date ON daily_reports(project_id, report_date DESC);

CREATE TABLE daily_report_media (
  report_id UUID REFERENCES daily_reports(id) ON DELETE CASCADE,
  media_id  UUID REFERENCES media(id) ON DELETE RESTRICT,
  caption   VARCHAR(255),
  PRIMARY KEY (report_id, media_id)
);

CREATE TABLE daily_report_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id       UUID REFERENCES daily_reports(id) ON DELETE CASCADE,
  task_id         UUID REFERENCES tasks(id) ON DELETE RESTRICT,
  progress_before INT NOT NULL,   -- explicit: absolute values, not deltas
  progress_after  INT NOT NULL,
  note            TEXT,
  UNIQUE (report_id, task_id)
);

-- ─────────────── MATERIALS ───────────────
CREATE TABLE materials_catalog (
  id            UUID PRIMARY KEY,
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name          VARCHAR(100) NOT NULL,
  unit          VARCHAR(20) NOT NULL,
  reorder_level NUMERIC(12,2) DEFAULT 10,
  standard_rate NUMERIC(12,2),
  archived_at   TIMESTAMPTZ,
  UNIQUE (org_id, lower(name))
);

CREATE TABLE material_transactions (
  id                    UUID PRIMARY KEY,
  project_id            UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  material_id           UUID NOT NULL REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  budget_line_id        UUID REFERENCES budget_lines(id),
  type                  txn_type NOT NULL,
  quantity              NUMERIC(12,2) NOT NULL CHECK (quantity > 0),
  unit_price            NUMERIC(12,2),
  supplier_name         VARCHAR(150),
  supplier_phone        VARCHAR(20),
  delivery_note_no      VARCHAR(60),
  task_id               UUID REFERENCES tasks(id),
  receipt_media_id      UUID REFERENCES media(id),
  transfer_pair_id      UUID REFERENCES material_transactions(id),
  source                fact_source DEFAULT 'manual',
  confidence            NUMERIC(4,3),
  supplier_confirmed_at TIMESTAMPTZ,          -- F-10.9 independent verification
  voided_at             TIMESTAMPTZ,
  voided_by             UUID REFERENCES memberships(id),
  void_reason           TEXT,
  created_by            UUID REFERENCES memberships(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key       TEXT UNIQUE NOT NULL,
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX idx_mt_project ON material_transactions(project_id, created_at DESC);
CREATE INDEX idx_mt_balance ON material_transactions(project_id, material_id)
  WHERE voided_at IS NULL;

-- Maintained by trigger under row lock; never recomputed on read (F-10.4).
CREATE TABLE material_balances (
  project_id  UUID REFERENCES projects(id) ON DELETE RESTRICT,
  material_id UUID REFERENCES materials_catalog(id) ON DELETE RESTRICT,
  balance     NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, material_id)
);

-- ─────────────── EXPENSES ───────────────
CREATE TABLE expenses (
  id               UUID PRIMARY KEY,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  budget_line_id   UUID NOT NULL REFERENCES budget_lines(id),
  category         VARCHAR(50),
  amount           NUMERIC(16,2) NOT NULL CHECK (amount > 0),
  description      TEXT,
  paid_to          VARCHAR(150),
  payment_method   VARCHAR(20),
  receipt_media_id UUID REFERENCES media(id),
  status           approval_status DEFAULT 'pending',
  approved_by      UUID REFERENCES memberships(id),
  approved_at      TIMESTAMPTZ,
  ocr_payload      JSONB,                 -- AI-2 raw extraction
  source           fact_source DEFAULT 'manual',
  voided_at        TIMESTAMPTZ,
  voided_by        UUID REFERENCES memberships(id),
  void_reason      TEXT,
  created_by       UUID REFERENCES memberships(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key  TEXT UNIQUE NOT NULL,
  CHECK (voided_at IS NULL OR void_reason IS NOT NULL)
);
CREATE INDEX idx_expenses_project ON expenses(project_id, created_at DESC);
CREATE INDEX idx_expenses_line    ON expenses(budget_line_id) WHERE voided_at IS NULL;

-- ─────────────── ATTENDANCE ───────────────
CREATE TABLE attendance_records (
  id              UUID PRIMARY KEY,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  work_date       DATE NOT NULL,
  trade           VARCHAR(50),
  headcount       INT NOT NULL CHECK (headcount >= 0),
  source          fact_source NOT NULL DEFAULT 'manual',
  confidence      NUMERIC(4,3),
  device_id       UUID,                   -- set when source = 'camera'
  recorded_by     UUID REFERENCES memberships(id),
  recorded_point  GEOGRAPHY(POINT,4326),
  within_geofence BOOLEAN,
  version         INT DEFAULT 1,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  idempotency_key TEXT UNIQUE NOT NULL,
  UNIQUE (project_id, work_date, trade, source, version)
);
CREATE INDEX idx_att_project_date ON attendance_records(project_id, work_date DESC);

-- Optional named attendance via QR badge (F-12.3). No biometrics (SEC-9).
CREATE TABLE worker_badges (
  id          UUID PRIMARY KEY,
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  badge_code  VARCHAR(40) UNIQUE NOT NULL,
  worker_name VARCHAR(100) NOT NULL,
  trade       VARCHAR(50),
  is_active   BOOLEAN DEFAULT TRUE
);

CREATE TABLE badge_scans (
  id              UUID PRIMARY KEY,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  badge_id        UUID NOT NULL REFERENCES worker_badges(id) ON DELETE RESTRICT,
  work_date       DATE NOT NULL,
  scanned_at      TIMESTAMPTZ NOT NULL,
  direction       VARCHAR(5) CHECK (direction IN ('in','out')),
  scanned_by      UUID REFERENCES memberships(id),
  idempotency_key TEXT UNIQUE NOT NULL,
  UNIQUE (badge_id, work_date, direction)
);

-- ─────────────── CLIENT PORTAL ───────────────
CREATE TABLE portal_links (
  id              UUID PRIMARY KEY,
  project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  recipient_name  VARCHAR(100),
  recipient_phone VARCHAR(20),
  token_hash      TEXT NOT NULL UNIQUE,     -- store hash, never the token
  pin_hash        TEXT NOT NULL,
  show_line_items BOOLEAN DEFAULT FALSE,
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES memberships(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE portal_access_log (
  id          BIGSERIAL PRIMARY KEY,
  link_id     UUID REFERENCES portal_links(id) ON DELETE CASCADE,
  accessed_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address  INET,
  user_agent  TEXT,
  pin_success BOOLEAN
);

-- ─────────────── AI ───────────────
CREATE TABLE ai_models (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  version     VARCHAR(30)  NOT NULL,
  task        VARCHAR(50)  NOT NULL,   -- ocr | person_count | material_count | ppe | anomaly
  runtime     VARCHAR(30),             -- api | edge | on_device
  deployed_at TIMESTAMPTZ DEFAULT NOW(),
  retired_at  TIMESTAMPTZ,
  UNIQUE (name, version)
);

CREATE TABLE ai_inferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  project_id    UUID REFERENCES projects(id) ON DELETE RESTRICT,
  model_id      UUID REFERENCES ai_models(id),
  subject_type  VARCHAR(40) NOT NULL,  -- expense | material_transaction | attendance | media
  subject_id    UUID,
  media_id      UUID REFERENCES media(id),
  output        JSONB NOT NULL,
  confidence    NUMERIC(4,3),
  status        inference_status DEFAULT 'proposed',
  human_value   JSONB,                 -- the corrected/accepted truth → training label
  reviewed_by   UUID REFERENCES memberships(id),
  reviewed_at   TIMESTAMPTZ,
  cost_estimate NUMERIC(10,6),         -- unit economics (§11.5)
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_inf_pending ON ai_inferences(project_id, status)
  WHERE status = 'proposed';
CREATE INDEX idx_inf_training ON ai_inferences(model_id, status)
  WHERE human_value IS NOT NULL;

-- Semantic search over reports (AI-8)
CREATE TABLE report_embeddings (
  report_id  UUID PRIMARY KEY REFERENCES daily_reports(id) ON DELETE CASCADE,
  embedding  VECTOR(1536),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────── SITE DEVICES [P2] ───────────────
CREATE TABLE site_devices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  device_type    VARCHAR(30) NOT NULL,   -- camera | edge_gateway
  label          VARCHAR(100),
  serial_number  VARCHAR(80) UNIQUE,
  installed_at   TIMESTAMPTZ,
  last_heartbeat TIMESTAMPTZ,
  status         VARCHAR(20) DEFAULT 'active',
  config         JSONB DEFAULT '{}'
);

CREATE TABLE device_events (
  id          BIGSERIAL PRIMARY KEY,
  device_id   UUID NOT NULL REFERENCES site_devices(id) ON DELETE CASCADE,
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  event_type  VARCHAR(40) NOT NULL,     -- person_cross | vehicle_entry | count_result
  occurred_at TIMESTAMPTZ NOT NULL,
  payload     JSONB NOT NULL,
  media_id    UUID REFERENCES media(id),
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_dev_events ON device_events(project_id, occurred_at DESC);

-- ─────────────── AUDIT ───────────────
CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  org_id      UUID NOT NULL,
  actor_id    UUID,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID,
  before      JSONB,
  after       JSONB,
  reason      TEXT,
  ip_address  INET,
  occurred_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_org    ON audit_log(org_id, occurred_at DESC);
