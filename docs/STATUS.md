# SiteLens — build status & session handoff

_Keep this current. It is the first thing to read when resuming work in a new
session. Newest status at the top of each section._

---

## M1 progress (current milestone)

Plan: `docs/M1_PLAN.md` (scope locked: full Next.js+Tailwind web app, Supabase Edge
Functions for BOQ processing, both Excel+PDF lanes). Build order A0→G.

- **A0 — auth token hook + login/org-switch: DONE (DB verified).**
  - `supabase/migrations/20260727130000_m1a0_auth_token_hook.sql`: `active_org` table,
    `custom_access_token_hook` (injects `active_org_id`/`user_role`/`membership_id` into
    the JWT so real GoTrue logins satisfy RLS), `fn_set_active_org` (org switch, authz),
    `fn_my_orgs` (enumerate switchable orgs past the org-scoped RLS).
  - `config.toml`: custom access-token hook enabled; dev phone-OTP test codes (no real SMS).
  - Test `supabase/tests/a0_token_hook.sql`: **ALL PASS** (hook injects correct org/role,
    authz rejects non-member switch, switching flips the claim, fn_my_orgs correct).
  - Web scaffold `apps/web/` (Next.js App Router + Tailwind): login (phone OTP), dashboard
    showing the decoded claim, OrgSwitcher. **Code-complete but not run on this box**
    (npm install / next dev blocked by slow network + Docker limits). See `apps/web/README.md`.
  - Full clean rebuild still green: **AC-6 49/0, A0 all pass.**
- **A–G — not started.** Next up: **A** (price write fn `fn_set_material_price` + live
  cost fn + AC-7 test).

To re-verify M1 so far, after the M0 rebuild steps below, also run:
`docker exec -i supabase_db_sitelens psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/a0_token_hook.sql`

---

## Where we are

- **Active milestone: M1** (the human flipped `CLAUDE.md` M0→M1 on 2026-07-27). M1/A0 is
  done (DB-verified); see the M1 progress section above.
- **M0 (Supabase project, schema, RLS, auth scaffold) — COMPLETE and VERIFIED.**
- **M0 acceptance gate AC-6 PASSES** ("Org A cannot read a single row of Org B by any
  route — verified against the API and the database directly"):
  - Direct DB route: **49 checks, 0 leaks**.
  - API route (PostgREST): **32 checks, 0 leaks**.
- Git: M0 + M1/A0 committed. Run `git log --oneline` to see commits.

## What M0 delivered (file map)

```
supabase/
  config.toml                     # from `supabase init`
  migrations/                     # applied in filename order; the whole schema
    20260727120000_extensions.sql   pgcrypto, postgis, vector, pg_cron
    20260727120100_enums.sql        6 v2 enums + 3 v3 enums (shared ones defined once)
    20260727120200_core_tenancy.sql organizations, app_users, memberships, projects, project_members
    20260727120300_v2_domain.sql    budget_lines, tasks, media, daily_reports(+media/tasks),
                                     materials_catalog, material_transactions, material_balances,
                                     expenses, attendance_records, worker_badges, badge_scans,
                                     portal_links, portal_access_log, ai_models, ai_inferences,
                                     report_embeddings, site_devices, device_events, audit_log
    20260727120400_v3_recipe_price.sql type_folders, building_types, type_stages, type_boq_items,
                                        type_stage_costs, material_prices
    20260727120500_v3_buildings.sql phases, batches, buildings, building_stage_progress
    20260727120600_v3_boq_plans.sql boq_imports, boq_import_rows, material_aliases, plans, plan_lines
    20260727120700_v3_alters.sql    building_id/stage_id/batch_id links on txns/expenses/reports
    20260727120800_functions.sql   current_org_id, current_membership_id, has_project_access, current_price
    20260727120900_rls.sql          ENABLE RLS + SELECT policies on all 41 tables; GRANT SELECT to authenticated
  seed.sql                        # Org A + Org B, users, memberships, projects, cross-org rows
  tests/rls_isolation.sql         # AC-6 direct-DB test (psql, role-switch, RAISE on leak)
tests/rls_api_test.mjs            # AC-6 API test (mints local JWT, hits PostgREST)
scripts/verify_m0.sh              # one-shot: db reset x2 + extensions + both AC-6 routes
docs/PRD.md                       # v3 PRD (planning engine) — source of §16 schema
docs/SiteLens_PRD_v2.md           # v2 PRD — source of the 26 base tables (§10.2) + helpers (§10.3)
docs/DECISIONS.md                 # every judgment call where the PRD was silent/wrong
docs/CLOUD_MIGRATION.md           # things to fix when moving local → managed cloud
docs/STATUS.md                    # this file
.env.example, .gitignore
```

- **41 SiteLens tables**, all with RLS enabled (the 42nd public table, PostGIS's
  `spatial_ref_sys`, is extension-owned reference data — see DECISIONS #10).
- **No client write policies** on any table in M0 (Rule 1): all writes will go
  through `SECURITY DEFINER` `fn_*` functions built in M1+. RLS-on + SELECT-only =
  clients can read (scoped) but cannot write directly.

## How it was verified (and the environment quirk)

This machine's Docker daemon **refuses `stop`/`kill`/`rm` on any container**
(`permission denied`). Because `supabase db reset` and `supabase start` recreate the
DB container, they cannot complete here (they error on the container kill). This is
an **environment limitation, not a schema defect** (DECISIONS #12).

We verified M0 anyway, against the already-running `supabase_db_sitelens` container:

```bash
C=supabase_db_sitelens
# 1) clean rebuild (what db reset does): wipe public, re-apply every migration + seed
docker exec -i $C psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO postgres, service_role;
SQL
for f in supabase/migrations/*.sql; do docker exec -i $C psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"; done
docker exec -i $C psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/seed.sql

# 2) AC-6 direct-DB route
docker exec -i $C psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/rls_isolation.sql
#   → "AC-6 PASS (direct DB): 49 checks, 0 leaks."

# 3) AC-6 API route — standalone PostgREST as the non-superuser authenticator role
docker exec -i $C psql -U supabase_admin -d postgres -c "ALTER ROLE authenticator WITH LOGIN PASSWORD 'postgres';"
docker run -d --name sitelens_rest_manual --network supabase_network_sitelens -p 3999:3000 \
  -e PGRST_DB_URI="postgres://authenticator:postgres@supabase_db_sitelens:5432/postgres" \
  -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
  -e PGRST_JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long" \
  public.ecr.aws/supabase/postgrest:v14.14
API_URL="http://127.0.0.1:3999" REST_PREFIX="" \
  JWT_SECRET="super-secret-jwt-token-with-at-least-32-characters-long" \
  node tests/rls_api_test.mjs
#   → "AC-6 PASS (API): 32 checks, 0 leaks."
```

**On a normal machine (no Docker restriction):** just `supabase start` then
`bash scripts/verify_m0.sh` — it runs `db reset` twice (reproducibility) + both AC-6
routes automatically. `verify_m0.sh` already falls back to `docker exec` psql when a
local `psql` isn't installed.

## Toolchain notes

- **Supabase CLI**: installed from the official GitHub release binary at
  `~/.local/bin/supabase` (symlinked into the nvm bin dir so it's on PATH). The npm
  package `supabase@2.109.1` is broken on this box (its platform binary dependency
  `@supabase/cli-linux-x64` ships without a `package.json`, so the JS shim can't
  resolve it). Use the `~/.local/bin/supabase` binary. (DECISIONS #7)
- **Network is very slow** here — the 70 MB CLI and the ~4 GB of Docker images took
  many resumed attempts. Images are now cached locally (`docker images`), so future
  `supabase start` is fast as long as containers aren't pruned.
- `psql` is NOT installed on the host; use the DB container's psql via `docker exec`.
- Node 20 is available (global `fetch`), used by the API test — no npm deps.

## Lingering local state

- Container `supabase_db_sitelens` is UP and healthy (port 54322). Its schema is the
  freshly-rebuilt M0 schema + seed.
- Container `sitelens_rest_manual` (PostgREST, port 3999) was left running for the
  API test; it can't be removed here due to the Docker restriction. Harmless.
- `authenticator` role password was set to `postgres` (local only).

## Next: M1 (only after the human flips the milestone line)

M1 = catalogue, price list, recipe library, BOQ import (Excel then PDF), item-mapping
memory. First `SECURITY DEFINER` write functions arrive here (e.g.
`fn_set_material_price`, `fn_confirm_boq_import`) — the first real exercise of Rule 1.
Gate: a real Excel BOQ imports and populates a type; aliases remembered.
