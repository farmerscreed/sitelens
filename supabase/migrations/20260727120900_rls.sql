-- M0 · Row Level Security on EVERY table (PRD.md §16.3 / SiteLens_PRD_v2.md §10.3)
-- Satisfies AC-6 "org A cannot read a row of org B" BY CONSTRUCTION.
--
-- Pattern:
--   * RLS ENABLED on every table, no exceptions.
--   * SELECT policies gate on current_org_id() / has_project_access().
--   * NO INSERT/UPDATE/DELETE policies anywhere in M0 — all writes go through
--     SECURITY DEFINER server functions (Rule 1). Financial/price/BOQ-commit
--     tables (expenses, material_transactions, material_balances, material_prices,
--     type_boq_items, boq_import_rows, ...) NEVER get client write policies, ever.
--   * The client portal reads via a separate token-keyed SECURITY DEFINER function
--     (M7) and never authenticates as a user — it does not touch these policies.
--
-- Table-level SELECT is granted to authenticated (Supabase already default-grants
-- this; re-stated here so the isolation test is deterministic). anon reads nothing:
-- current_org_id() is NULL for anon, so every policy below evaluates false.

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

-- ═══════════════ TENANCY ═══════════════
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY organizations_select ON organizations FOR SELECT
  USING (id = current_org_id());

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_users_select ON app_users FOR SELECT
  USING (
    id = auth.uid()
    OR EXISTS (SELECT 1 FROM memberships m
               WHERE m.user_id = app_users.id AND m.org_id = current_org_id())
  );

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (org_id = current_org_id());

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY projects_select ON projects FOR SELECT
  USING (org_id = current_org_id() AND has_project_access(id));

ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_members_select ON project_members FOR SELECT
  USING (has_project_access(project_id));

-- ═══════════════ v2 DOMAIN ═══════════════
ALTER TABLE budget_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY budget_lines_select ON budget_lines FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tasks_select ON tasks FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE media ENABLE ROW LEVEL SECURITY;
CREATE POLICY media_select ON media FOR SELECT
  USING (org_id = current_org_id()
         AND (project_id IS NULL OR has_project_access(project_id)));

ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_reports_select ON daily_reports FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE daily_report_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_report_media_select ON daily_report_media FOR SELECT
  USING (EXISTS (SELECT 1 FROM daily_reports r
                 WHERE r.id = daily_report_media.report_id
                   AND has_project_access(r.project_id)));

ALTER TABLE daily_report_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_report_tasks_select ON daily_report_tasks FOR SELECT
  USING (EXISTS (SELECT 1 FROM daily_reports r
                 WHERE r.id = daily_report_tasks.report_id
                   AND has_project_access(r.project_id)));

ALTER TABLE materials_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY materials_catalog_select ON materials_catalog FOR SELECT
  USING (org_id = current_org_id());

-- financial (no write policies, ever)
ALTER TABLE material_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_transactions_select ON material_transactions FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE material_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_balances_select ON material_balances FOR SELECT
  USING (has_project_access(project_id));

-- financial (no write policies, ever)
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_select ON expenses FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY attendance_records_select ON attendance_records FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE worker_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY worker_badges_select ON worker_badges FOR SELECT
  USING (org_id = current_org_id());

ALTER TABLE badge_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY badge_scans_select ON badge_scans FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE portal_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_links_select ON portal_links FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE portal_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY portal_access_log_select ON portal_access_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM portal_links pl
                 WHERE pl.id = portal_access_log.link_id
                   AND has_project_access(pl.project_id)));

-- ai_models is a global reference table (model name/version/task) with no tenant
-- data; readable by any authenticated user. RLS still enabled (no exceptions).
ALTER TABLE ai_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_models_select ON ai_models FOR SELECT
  USING (auth.role() = 'authenticated');

ALTER TABLE ai_inferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_inferences_select ON ai_inferences FOR SELECT
  USING (org_id = current_org_id()
         AND (project_id IS NULL OR has_project_access(project_id)));

ALTER TABLE report_embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_embeddings_select ON report_embeddings FOR SELECT
  USING (EXISTS (SELECT 1 FROM daily_reports r
                 WHERE r.id = report_embeddings.report_id
                   AND has_project_access(r.project_id)));

ALTER TABLE site_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY site_devices_select ON site_devices FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE device_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_events_select ON device_events FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_select ON audit_log FOR SELECT
  USING (org_id = current_org_id());

-- ═══════════════ v3 RECIPE / PRICE ═══════════════
ALTER TABLE type_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY type_folders_select ON type_folders FOR SELECT
  USING (org_id = current_org_id());

ALTER TABLE building_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY building_types_select ON building_types FOR SELECT
  USING (org_id = current_org_id());

ALTER TABLE type_stages ENABLE ROW LEVEL SECURITY;
CREATE POLICY type_stages_select ON type_stages FOR SELECT
  USING (EXISTS (SELECT 1 FROM building_types bt
                 WHERE bt.id = type_stages.building_type_id
                   AND bt.org_id = current_org_id()));

-- BOQ recipe quantities (no write policies, ever — Rule 1/4)
ALTER TABLE type_boq_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY type_boq_items_select ON type_boq_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM building_types bt
                 WHERE bt.id = type_boq_items.building_type_id
                   AND bt.org_id = current_org_id()));

ALTER TABLE type_stage_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY type_stage_costs_select ON type_stage_costs FOR SELECT
  USING (EXISTS (SELECT 1 FROM building_types bt
                 WHERE bt.id = type_stage_costs.building_type_id
                   AND bt.org_id = current_org_id()));

-- price list (no write policies, ever — writes via fn_set_material_price)
ALTER TABLE material_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_prices_select ON material_prices FOR SELECT
  USING (org_id = current_org_id());

-- ═══════════════ v3 PHASES / BATCHES / BUILDINGS ═══════════════
ALTER TABLE phases ENABLE ROW LEVEL SECURITY;
CREATE POLICY phases_select ON phases FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY batches_select ON batches FOR SELECT
  USING (has_project_access(project_id));

ALTER TABLE buildings ENABLE ROW LEVEL SECURITY;
CREATE POLICY buildings_select ON buildings FOR SELECT
  USING (org_id = current_org_id() AND has_project_access(project_id));

ALTER TABLE building_stage_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY building_stage_progress_select ON building_stage_progress FOR SELECT
  USING (EXISTS (SELECT 1 FROM buildings b
                 WHERE b.id = building_stage_progress.building_id
                   AND has_project_access(b.project_id)));

-- ═══════════════ v3 BOQ IMPORT / PLANS ═══════════════
ALTER TABLE boq_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY boq_imports_select ON boq_imports FOR SELECT
  USING (org_id = current_org_id());

-- BOQ-commit staging (no write policies, ever — writes via fn_confirm_boq_import)
ALTER TABLE boq_import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY boq_import_rows_select ON boq_import_rows FOR SELECT
  USING (EXISTS (SELECT 1 FROM boq_imports bi
                 WHERE bi.id = boq_import_rows.import_id
                   AND bi.org_id = current_org_id()));

ALTER TABLE material_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_aliases_select ON material_aliases FOR SELECT
  USING (org_id = current_org_id());

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_select ON plans FOR SELECT
  USING (org_id = current_org_id());

ALTER TABLE plan_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY plan_lines_select ON plan_lines FOR SELECT
  USING (EXISTS (SELECT 1 FROM plans p
                 WHERE p.id = plan_lines.plan_id
                   AND p.org_id = current_org_id()));
