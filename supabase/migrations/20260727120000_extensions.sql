-- M0 · Extensions (PRD v2 §10.2 / v3 §16.2)
-- Portability: every schema change is a migration; db reset must rebuild from these.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
