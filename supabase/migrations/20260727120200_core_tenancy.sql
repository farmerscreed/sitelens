-- M0 · Core tenancy (SiteLens_PRD_v2.md §10.2)
-- Identity separated from membership so one human can serve multiple orgs (§5.2).

CREATE TABLE organizations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(150) NOT NULL,
  country_code CHAR(2) DEFAULT 'NG',
  currency     CHAR(3) DEFAULT 'NGN',
  settings     JSONB DEFAULT '{}',        -- thresholds, notification timings
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  archived_at  TIMESTAMPTZ
);

-- Global identity. One human, one row, regardless of how many orgs.
-- id mirrors auth.users.id (Supabase Auth). No FK to auth schema by design.
CREATE TABLE app_users (
  id         UUID PRIMARY KEY,            -- mirrors auth.users.id
  full_name  VARCHAR(100) NOT NULL,
  phone      VARCHAR(20) UNIQUE NOT NULL,
  email      VARCHAR(100),
  locale     VARCHAR(10) DEFAULT 'en-NG',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE memberships (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id        UUID NOT NULL REFERENCES app_users(id)     ON DELETE RESTRICT,
  role           org_role NOT NULL,
  is_active      BOOLEAN DEFAULT TRUE,
  deactivated_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE projects (
  id                UUID PRIMARY KEY,
  org_id            UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name              VARCHAR(150) NOT NULL,
  description       TEXT,
  location_text     VARCHAR(255),
  centroid          GEOGRAPHY(POINT,4326),
  geofence_radius_m INT DEFAULT 150 CHECK (geofence_radius_m BETWEEN 50 AND 500),
  start_date        DATE,
  target_end_date   DATE,
  total_budget      NUMERIC(16,2),
  status            VARCHAR(20) DEFAULT 'active',
  created_by        UUID REFERENCES app_users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  archived_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_active_project_name
  ON projects(org_id, lower(name)) WHERE archived_at IS NULL;
CREATE INDEX idx_projects_geo ON projects USING GIST (centroid);

CREATE TABLE project_members (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  membership_id  UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  role_override  org_role,
  UNIQUE (project_id, membership_id)
);
CREATE INDEX idx_pm_membership ON project_members(membership_id);
