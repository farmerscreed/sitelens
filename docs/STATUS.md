# SiteLens — build status & session handoff

_Keep this current. It is the first thing to read when resuming work in a new
session. Newest status at the top of each section._

---

## 2026-07-29 — CLOUD LIVE: web console deployed, email login works, UI redesigned

The pilot infrastructure is now standing up on managed cloud. State at end of session:

**Cloud Supabase** (`gwzpqnnwflwkcrowolgx`, London): all 28 migrations + edge functions +
secrets + `custom_access_token` hook live. Org #1 **Vantara International** provisioned
(founder auth id `…0002`). See `docs/CLOUD_MIGRATION.md`.

**Web console DEPLOYED to Vercel** → **https://sitelens-eosin.vercel.app**
(project `sitelens`, repo github.com/farmerscreed/sitelens, branch `master`, auto-deploy on push).

**Login WORKS via email OTP.** Founder signs in with **biebele@gmail.com** → 6-digit code.
Cloud auth uses **Resend SMTP**, sender `noreply@leiko.app` (leiko.app = verified Resend
domain; account owner tawokels@gmail.com). Email rate limit raised to 100/hr. Phone OTP
(Termii `send-sms` hook) is **disabled** — it 500'd; deferred to the mobile app.

**UI redesigned** to a dark "command console" (amber hi-vis accent, glass panels, sidebar
shell). Full architecture + design system documented in **`docs/WEB_CONSOLE.md`**.

**Multi-project is fully usable.** The engine (project-scoped tables + `has_project_access`
RLS) always existed; added the front door: migration `20260729000000_projects_write_fns`
(`fn_create_project`/`fn_rename_project`/`fn_archive_project`, admin/PM only — **29 migrations
now**), a `/projects` page (create/rename/archive), and a **sticky top-bar project switcher**
(`sl_project` cookie; a stale/foreign cookie can never surface another project's data). Data
is isolated per project; recipes/prices/plans are intentionally org-wide.

**Inventory/usage built out.** Materials page shows the full catalog + stock value + a
**Usage-vs-BOQ** section (planned recipe qty vs actual OUT, over-consumption flagged). Note:
the founder org still has **0 material transactions** — the store reads empty until real
opening stock is logged (IN). Email OTP length fixed 8→6.

**New-machine setup:** see **`docs/DEV_SETUP.md`** (clone + env + run + Claude Code).

**Production 500 FIXED:** server components were passing inline `onChange` to `<select>`
(React forbids it) → crashed /board /materials /expenses /portal-links. Now a client
`<ProjectPicker>`. All four return 307→login (verified), render correctly once signed in.

**Open (not blocking the console):** revoke the exposed `sbp_…` token; enable PITR + restore
drill; Termii phone OTP for mobile; DPAs before real personal data; WhatsApp BSP application.
Only farmerscreed's GitHub-noreply committer email deploys on Vercel Hobby (see WEB_CONSOLE.md).

---

## M8 (current milestone) — PILOT (operational, not a feature build)

Runbook: `docs/M8_PILOT.md`. M8 = cloud cutover → provision org #1 → **21 consecutive
days of real reports** → an adversarial break-it pass (12 attacks mapped to the Golden
Rules / ACs) → exit gate. No new migrations/tests here; the buildable product (M0–M7) is
done and green. Confirm on real usage: AC-2 (media derivatives), AC-14 (report < 90 s),
AC-16 (PITR restore). Start the WhatsApp BSP application early (long lead). This needs the
founder's live project + cloud infra + real keys — see `docs/CLOUD_MIGRATION.md`.

---

## M7 (complete) — DB verified; edge/notify dev-mode

Plan: `docs/M7_PLAN.md`. Gate **AC-13**: client opens portal with link+PIN (no account);
revocable; every access logged.

- **Backend (verified):** `m7a_portal` — `fn_create_portal_link` (token sha256 + PIN
  bcrypt, shown once), `fn_portal_view` (anon, token-keyed, logs every access, RETURNS
  errors so the log persists, safe columns only — no supplier/price/worker), `fn_revoke`/
  `fn_renew`; `dev_outbox` + `fn_notify`. `m7b_digest` — `fn_project_weekly_summary`,
  `fn_spend_anomaly`, `fn_run_weekly_digests` + **pg_cron** `sitelens-weekly-digest`.
- **Tests PASS:** `ac13_portal`, `m7_notify`.
- **Web:** public `app/portal/[token]` (PIN → safe view), `app/portal-links`
  (create/revoke/last-opened), `app/notifications` (dev outbox). tsc clean.
- Full suite green (28 migrations, 17 suites): + AC-13, notify/digest.

The human flips `CLAUDE.md` M7→M8 when satisfied. **M8** = pilot on the founder's live
project (the real gate) — run for 21 days and have someone try to defeat it.

---

## M6 (complete)

Plan: `docs/M6_PLAN.md`. Gates: **AC-3** (resubmitted photo flagged) + **reorder advice
matches remaining BOQ**.

- **Backend (verified):** `m6a_ai` — `fn_phash_hamming` + `fn_register_media` near-dup
  (Hamming ≤ 8, 90-day window, AC-3); `fn_reorder_advice` (remaining BOQ vs stock →
  order); `fn_record_inference`/`fn_resolve_inference` (Rule 3 propose→verdict=label);
  `fn_match_reports` (pgvector cosine over report_embeddings).
- **Tests PASS:** `ac3_duplicate_photo`, `m6_reorder_advice`, `m6_inference`.
- **Edge (code-complete, DEV_AI_MODE):** `receipt-ocr` (AI-2 vision + typed-amount
  cross-check → proposal), `ask` (AI-8 embed → pgvector retrieval + live figures → answer).
  AI-3 photo quality gate is on-device (Flutter, deferred to build).
- **Web:** `app/ask` (question box), reorder-advice panel on materials, `app/ai`
  (accept/reject AI proposals). tsc clean.
- Full suite green (26 migrations, 15 suites): + AC-3, reorder, inference.

The human flips `CLAUDE.md` M6→M7 when satisfied. **M7** = client portal + notifications
+ weekly digest.

---

## M5 (complete)

Plan: `docs/M5_PLAN.md`. Gates **AC-4** (balances never negative), **AC-9** (stage
overrun flags at completion), **AC-11** (no spend without approval).

- **Backend (verified):** `m5a_materials` (`fn_log_material_txn` — FOR UPDATE row-locked
  balance, negative-stock rejection, idempotent, reorder alert; `fn_void_material_txn`;
  `fn_transfer_material`; `fn_upsert_material`). `m5b_expenses` (`fn_create_expense`
  pending; `fn_approve_expense` threshold authority; `fn_void_expense`). `m5c_req_actual`
  (`building_req_vs_actual` view + `fn_complete_stage` overrun flag). No client write
  policy (Rule 1).
- **Tests PASS:** `ac4_material_balance`, `ac9_overrun`, `ac11_expense_approval`.
- **Web:** `app/materials` (balances + reorder + log IN/OUT), `app/expenses`
  (create/approve/void), building card **consumed-vs-required** (M2 seam closed). tsc clean.
- Full suite green (25 migrations, 12 suites): + AC-4, AC-9, AC-11.

The human flips `CLAUDE.md` M5→M6 when satisfied. **M6** = AI (dup-photo hash, receipt/
BOQ OCR, quality gate, questions, reorder advice).

---

## M4 (complete) — backend verified; Flutter scaffolded

Plan: `docs/M4_PLAN.md`. Gate **AC-1**: an engineer submits a daily report fully offline;
it syncs with no duplicates and no loss.

- **Backend (verified):** `m4a_daily_report` — `fn_submit_daily_report` (idempotent on
  idempotency_key → lost-ack retry is a no-op; amendment→new version; backdate>3d
  rejected; links media/tasks; membership-gated) and `fn_register_media` (idempotent on
  client id; geofence + mock-location + exact-phash duplicate flags); private
  `report-media` bucket + org-scoped storage RLS.
- **Test `ac1_offline_sync.sql`: PASS** — offline submit, **retry with same
  idempotency_key creates NO duplicate** report/media, amendment versions,
  geofence/backdate/phash/authz.
- **Mobile:** `apps/mobile/` Flutter scaffold — Drift local store (source of truth),
  outbox + sync worker (UUIDv7, idempotency, backoff), report repository (write-local-
  then-enqueue), capture service (3 derivatives + aHash). **Code-complete, not built on
  this box** (no Flutter SDK) — mirrors the verified server contract. See its README.
- Full suite green (22 migrations): AC-6, A0, AC-7, B, AC-5, G, M2, AC-8, **AC-1**.

The human flips `CLAUDE.md` M4→M5 when satisfied. **M5** = materials + expenses +
approvals + requirement-vs-actual (the M2 board's "consumed vs required" seam closes).

---

## M3 (complete)

Plan: `docs/M3_PLAN.md`. Gate **AC-8**: correct period-by-period cash requirement, peak,
and total for a staggered multi-type/multi-batch plan; recompute across 300 < 5 s.

- **Backend (verified):** `m3a_plans` (`fn_create_plan`, `fn_set_plan_line` upsert,
  `fn_update_plan` — manager-gated, no client write policy). `m3b_feasibility`:
  `fn_compute_feasibility` (timeline placement, per-period outflow + cumulative +
  inflows, total, `peak_period_requirement`, `peak_funding`) and `fn_max_delivery`
  (F-PLAN-5). Quantity is a multiplier → O(lines×stages), fast for 300 (NF-13). Results
  always computed live (F-PLAN-6).
- **Test `ac8_feasibility.sql`: PASS** — exact staggered 2-type/2-batch timeline,
  staggering lowers peak-period (F-PLAN-4), price change re-costs a saved plan live
  (AC-7 tie), max-delivery arithmetic, authz, 300-qty sanity.
- **Web:** `app/planner` (scenarios) + `app/planner/[id]` (lines, batch schedule,
  available cash, live cash-flow timeline + peaks + total, max-delivery view). tsc clean.
- Full suite green (21 migrations): AC-6, A0, AC-7, B, AC-5, G, M2, **AC-8**.

The human flips `CLAUDE.md` M3→M4 when satisfied. **M4** = daily report + media pipeline
+ offline sync (first Flutter/mobile work).

---

## M2 (complete)

Plan: `docs/M2_PLAN.md`. Gate: **58 buildings stamped from 2 types; board shows each at
its stage** (built for 300). Decisions locked: stage completion web-driven now (mobile
in M4); requirement-vs-actual shows the required side now (actual + overrun in M5).

- **Backend (verified):** `m2a_buildings` (`fn_create_buildings` stamps N from a type
  version + seeds `building_stage_progress`; `fn_create_phase`, `fn_create_batch`),
  `m2c_stage_progress` (`fn_complete_stage`), `m2d_batches_board` (`fn_advance_batch`
  manual/logged, `fn_batch_cost`, `board_view` with `security_invoker`). All
  manager-gated, no client write policy (Rule 1).
- **Test `m2_buildings_board.sql`: PASS** — 58 buildings, stage progress seeded, board
  spread across columns, version stamping keeps old version, batch advance+cost, authz,
  300-scale sanity.
- **Web:** `app/board` (columns by stage, filter by batch/type, stamp, start-batch,
  complete-stage per card) + `app/buildings/[id]` (stage progress + required materials
  for completed stages). tsc clean; unrun on this box.
- Full suite green (19 migrations): AC-6, A0, AC-7, B, AC-5, G, **M2**.

The human flips `CLAUDE.md` M2→M3 when satisfied. **M3** = feasibility planner (cash-flow).

---

## M1 (complete)

Plan: `docs/M1_PLAN.md` (full Next.js+Tailwind web app, Supabase Edge Functions for BOQ,
both Excel+PDF lanes). Build order A0→G.

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
- **A — price write path + live cost: DONE (verified).**
  - `supabase/migrations/20260727140000_m1a_price_and_cost.sql`: `fn_set_material_price`
    (admin-gated, append-only dated, audited — the ONLY write path into `material_prices`,
    Rule 1) + unique dated-price index; `fn_type_cost` (Σ qty×current_price + stage costs,
    computed live — Rule 4).
  - Test `supabase/tests/ac7_price_recost.sql`: **AC-7 PASS** — live re-costing, dated
    history preserved, future price deferred, authz (cross-org + wrong-material) + audit.
  - Web: `apps/web/app/prices` + `SetPriceForm` (RPC only). Code-complete, unrun here.
- **B — recipe write fns + versioning + editor UI: DONE (verified).** `m1b_recipe_fns`:
  manager-gated fns (create type, add stage, set boq item [no price], set stage cost,
  duplicate, new version, folder) + `fn_require_org_manager`. Test `b_recipe.sql` PASS.
  Web `app/recipes` + editor.
- **C — storage adapter + bucket + signed-url edge fn: DONE.** `m1c_storage` (private
  `boq-sources` bucket + org-scoped storage RLS); `lib/storage` adapter (R2 seam);
  `storage-signed-url` edge fn (15-min, permission-checked).
- **D — Excel lane: DONE (verified).** `m1d_boq_import`: `boq_column_mappings` +
  `fn_create_boq_import`/`fn_stage_boq_rows`/`fn_remember_column_mapping`. `boq-parse`
  edge fn (SheetJS). Web import wizard.
- **E — PDF lane: DONE.** `_shared/ai-router.ts` (OpenRouter + `DEV_AI_MODE`) +
  `boq-extract-pdf` edge fn (proposals, Rule 3).
- **F — confirm + item-mapping memory: DONE (AC-5 verified).** `m1f_boq_confirm`:
  `fn_confirm_boq_import` (atomic, idempotent → `type_boq_items` + aliases) +
  `fn_resolve_material` auto-map. Test `ac5_boq_import.sql` **AC-5 PASS**. Web
  `boq-import/[id]` review/confirm.
- **G — hardening: DONE.** `g_hardening.sql` PASS (non-manager blocked on all M1 write
  paths; new tables org-isolated).

**M1 COMPLETE — gate met.** PRD §17 M1 gate ("a real Excel BOQ imports and populates a
type; aliases remembered") = **AC-5 PASS**; plus **AC-7 PASS** (price re-costing). Edge
functions + web app are code-complete but not run on this box (npm/edge runtime blocked
by slow network + Docker limits) — DB layer fully verified.

**Re-verify everything with one command:** `bash scripts/verify_all.sh` → rebuilds all 16
migrations + seed and runs all 6 suites (AC-6, A0, AC-7, B, AC-5, G) via docker exec.

The human flips `CLAUDE.md` ACTIVE MILESTONE M1→M2 when satisfied. **M2** = buildings,
phases, batches, the board, stage progress (gate: 58 buildings stamped from 2 types;
board shows each at its stage) — the first consumers of the recipe library + versioning.

---

## Where we are

- **Active milestone: M8 — the pilot (operational).** M0–M7 (all buildable milestones)
  are COMPLETE and verified; see the sections above. M8 is the live run per
  `docs/M8_PILOT.md` — cloud cutover + 21 days + break-it. No further product build is
  gated behind it; it's real-world validation.
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

## Next: M8 — pilot on the live project (the real gate)

M8 is not a feature build — it's the pilot (PRD §17): run SiteLens on the founder's own
buildings for **21 consecutive days of real reports**, and instruct someone to actively
try to defeat it (fake a report, double-log a delivery, sneak an over-threshold expense).
What they find is worth more than another month of features. This is the point where the
system moves to managed cloud Supabase (PITR on — SEC-12/AC-16) and the deferred external
services get real keys (Termii, R2, OpenRouter, WhatsApp BSP) — see CLOUD_MIGRATION.md.
Also fold in the remaining acceptance criteria not yet exercised end-to-end (AC-2 media
derivatives, AC-14 median report < 90 s, AC-16 restore drill) against real usage.
