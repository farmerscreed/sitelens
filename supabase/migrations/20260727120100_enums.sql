-- M0 · Enums
-- v2 enums (SiteLens_PRD_v2.md §10.2) defined ONCE here.
-- v3 (PRD.md §16.2) re-declares fact_source/txn_type/approval_status identically;
-- they are intentionally NOT redeclared below (would raise "type already exists").
-- Only the genuinely new v3 enums are added: stage_status, import_status, plan_mode.
-- See docs/DECISIONS.md #1.

-- ── v2 enums ─────────────────────────────────────
CREATE TYPE org_role         AS ENUM ('admin','pm','engineer','client');
CREATE TYPE fact_source      AS ENUM ('manual','qr','ocr','camera','model','import');
CREATE TYPE txn_type         AS ENUM ('IN','OUT');
CREATE TYPE approval_status  AS ENUM ('pending','approved','rejected','voided');
CREATE TYPE task_status      AS ENUM ('not_started','in_progress','done','blocked');
CREATE TYPE inference_status AS ENUM ('proposed','accepted','rejected','superseded');

-- ── v3 additions ─────────────────────────────────
-- stage_status is value-identical to task_status but kept as the distinct name
-- v3 uses for building_stage_progress.status (DECISIONS.md #2).
CREATE TYPE stage_status     AS ENUM ('not_started','in_progress','done','blocked');
CREATE TYPE import_status    AS ENUM ('uploaded','parsing','review','confirmed','failed');
CREATE TYPE plan_mode        AS ENUM ('funding_required','max_delivery');
