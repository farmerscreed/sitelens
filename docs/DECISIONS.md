# DECISIONS — running log of judgment calls where the PRD was silent

Per CLAUDE.md, every place we had to decide something the PRD did not spell out is
logged here so the founder can review drift. Newest at the bottom.

## M0 — Supabase project, schema, RLS, auth scaffold

1. **Shared enums defined once.** `PRD.md` (v3) §16.2 re-declares `fact_source`,
   `txn_type`, and `approval_status` with values identical to `SiteLens_PRD_v2.md`
   §10.2. Postgres cannot `CREATE TYPE` the same name twice, so these three are
   defined only in `..._enums.sql` (from v2, which loads first) and the v3 block
   adds only the genuinely new enums. No behavioural change.

2. **`stage_status` kept distinct from `task_status`.** They share the same four
   values (`not_started,in_progress,done,blocked`). v3 uses `stage_status` for
   `building_stage_progress.status`; v2 uses `task_status` for `tasks.status`.
   Kept as two names to match each PRD exactly rather than collapsing them.

3. **`app_users.id` mirrors `auth.users.id`, with no FK to the auth schema.** The
   v2 DDL comments "mirrors auth.users.id" but declares no foreign key. We keep it
   that way: the app identity row is created/kept in sync by application code (or,
   later, a trigger on `auth.users`). This also lets the seed insert identities
   directly for the isolation test without provisioning GoTrue users. Local auth
   uses an auto-confirm / fixed-OTP shim (CLAUDE.md) — never a real SMS.

4. **RLS SELECT policies for tables without a direct `org_id`/`project_id`.** Child
   tables (`daily_report_media`, `daily_report_tasks`, `report_embeddings`,
   `portal_access_log`, `type_stages`, `type_boq_items`, `type_stage_costs`,
   `building_stage_progress`, `boq_import_rows`, `plan_lines`) gate via an `EXISTS`
   join to a parent that carries the org/project, reusing `has_project_access()` /
   `current_org_id()`. `ai_models` is a global, non-tenant reference table, so its
   policy is `auth.role() = 'authenticated'` (readable by any signed-in user). RLS
   is still ENABLED on it — no table is left without RLS.

5. **No write (INSERT/UPDATE/DELETE) policies anywhere in M0.** Per Rule 1 all
   writes go through `SECURITY DEFINER` server functions (`fn_*`), which land in
   M1+. Until then, RLS-enabled tables with only SELECT policies simply reject all
   client writes — exactly the guard rail we want. Financial/price/BOQ-commit
   tables (`expenses`, `material_transactions`, `material_balances`,
   `material_prices`, `type_boq_items`, `boq_import_rows`) NEVER get client write
   policies, ever.

6. **AC-6 tested two ways, matching the acceptance wording ("against the API and
   the database directly").** DB route: `supabase/tests/rls_isolation.sql` — a
   psql script that `SET ROLE authenticated`, sets `request.jwt.claims`, and
   asserts zero cross-org rows (RAISE on any leak). We chose plain DO-block
   assertions over pgTAP because the test must run as the non-owner
   `authenticated` role and pgTAP's bookkeeping tables (owned by postgres) aren't
   writable by that role. API route: `tests/rls_api_test.mjs` — mints a local
   HS256 JWT and hits PostgREST, asserting the same. No external/paid calls.

7. **CLI install fell back from `npm i -g supabase` to the official GitHub release
   binary.** The npm 2.x package ships the real Go binary in an optional platform
   package (`@supabase/cli-linux-x64`) that arrived WITHOUT a `package.json`, so
   the JS shim could not resolve it (`No matching Supabase CLI binary package`).
   The user chose npm; the npm package is structurally broken on this box, so we
   use the documented Linux release binary instead — same `supabase` CLI, cleaner.

8. **M0 scope trimmed to DB/schema/RLS/auth + tests.** Per the founder's choices:
   `git init` now (done); CI pipeline deferred; WhatsApp BSP application is an
   external/human step (tracked in CLOUD_MIGRATION.md). Termii/R2/OpenRouter are
   shimmed/deferred.
