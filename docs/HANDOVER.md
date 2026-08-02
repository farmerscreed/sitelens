# SiteLens — Session Handover (as of 2026-08-03)

> **Read this first when resuming in a new session.** It is the single orientation doc:
> where we are, how to run + deploy on THIS machine, what was built, what's next.
> Deeper detail lives in `docs/STATUS.md` (session log), `docs/DECISIONS.md` (#1–63
> judgment calls), `docs/PRD.md` (spec), `docs/CLOUD_MIGRATION.md`, `docs/DEV_SETUP.md`,
> `docs/M8_PILOT.md`, and `CLAUDE.md` (standing orders — obey them).

---

## 1. TL;DR — where we are

- **Milestone: M8 (pilot).** M0–M7 are built + verified. The product runs live on managed
  cloud Supabase + Vercel.
- **This session** finished pilot Areas 1–5 (web), deferred Area 4 (mobile), and built a
  **full off-plan CLIENT SYSTEM**: standardized milestones, sales & milestone/time-linked
  payments, a two-audience client portal (v2), and a redesigned dashboard.
- **State of the tree: `bash scripts/verify_all.sh` → 50 migrations, 31 suites green.**
  Everything is committed to `master`, deployed to cloud (DB) + Vercel (web).
- **Live app:** https://sitelens-eosin.vercel.app · founder login `biebele@gmail.com` (email OTP).
- **Cloud project:** SiteLens `gwzpqnnwflwkcrowolgx` (eu-west-2 / London), Postgres 17.

---

## 2. How to RESUME on this box (environment quirks — important)

This machine has three quirks that block a naive start. All are known-good workarounds:

1. **Docker Desktop must be running.** If not: launch `C:\Program Files\Docker\Docker\Docker Desktop.exe`
   and wait ~1–2 min for the daemon.
2. **Port conflict with other local Supabase projects.** After a Docker reboot, project
   **`leiko`** (and others) auto-start and squat on ports 54321–54327 that `sitelens` needs.
   Fix: `supabase stop --project-id leiko` (data is backed up), then `supabase start`.
3. **CLI config-key mismatch.** `supabase/config.toml` uses the newer `[local_smtp]` key, but
   this box's Supabase CLI is **2.98.1**, which only accepts the old `[inbucket]`. To start:
   temporarily rename `[local_smtp]` → `[inbucket]`, run `supabase start`, then **restore it**
   to `[local_smtp]` (keeps git clean). *Durable fix:* upgrade the CLI to ≥2.111 (⚠️ global —
   also affects the other local projects jarvis/kena-app/LawApp).

**Run the tests / rebuild the schema:** `bash scripts/verify_all.sh`. On this box the Docker
daemon blocks container recreation, so `supabase db reset` / `supabase start` can't fully
reset — `verify_all.sh` does the equivalent: DROP SCHEMA → re-apply all migrations → seed →
run every test via `docker exec` into `supabase_db_sitelens`. It is the source of truth for
"is the DB green."

**Run the web app:** `cd apps/web && npm install && npm run dev`. `apps/web/.env.local` points
at **CLOUD** (so the local dev app shows real pilot data). Note: local `next build` FAILS on
this box (it can't fetch Google Fonts — network); Vercel builds fine, so ship via push, and
gate correctness with `npm run typecheck`, not a local build.

---

## 3. How everything is DEPLOYED (the procedure used all session)

- **DB → cloud:** apply each migration with the **Supabase MCP `apply_migration`**
  (`project_id: gwzpqnnwflwkcrowolgx`). Do **NOT** `supabase db push` — the cloud migration
  ledger uses different names than local, so push would try to re-apply everything. This box's
  `SUPABASE_ACCESS_TOKEN` lacks DDL privilege (curl to the Management API 403s) and there's no
  cloud DB password here, so the **MCP is the only cloud-DDL path** — the founder must approve
  the MCP write if the harness safety classifier blocks it.
- **Web → cloud:** merge the feature branch to `master` and `git push origin master` → Vercel
  auto-deploys. Commit email **must** be `29656494+farmerscreed@users.noreply.github.com`
  (Vercel Hobby rule) — it already is.
- Verify a cloud DDL change with a read-only `execute_sql` afterward (that's how each piece was
  confirmed against PE009 this session).

---

## 4. What was built THIS session (with the file map)

Chronological; all green + deployed. DECISIONS refs in parentheses.

- **Archive (soft-delete) for buildings + recipes** (#57): `fn_archive_building` /
  `fn_unarchive_building` / `fn_archive_building_type` / `fn_unarchive_building_type`; partial
  unique index frees a building code for re-stamping; `board_view` filters archived.
  UI: `ArchiveBuildingButton`, recipe archive in `RecipeEditor`.
- **Earned value blends the QS-rate fallback** (#58): `building_work_ev` planned/earned now
  `COALESCE(own build-up, boq_rate)` + `est_source` label; building page tags "QS rate" lines.
- **Materials unified on the take-off + split by grain** (#59): `type_material_plan_stage` /
  `type_material_plan` (take-off with `type_boq_items` fallback); `building_req_vs_actual`
  repointed (+`planned_total`); new `batch_material_plan`; `fn_reorder_advice` + AC-9 overrun
  on the unified plan. Materials page = store + project procurement + by-batch; building page
  "Usage vs plan" per house. Also: expenses building-tag + "Spend on this building" breakdown.
- **Planner true-cost + redesign** (#60): `type_stage_cost` view (work-item est_cost per
  stage, legacy fallback); `fn_compute_feasibility` / `fn_max_delivery` read it; `fn_delete_plan_line`;
  `fn_set_type_stage_days` (stage durations → cost SPREAD across periods). `PlanEditor` redesigned
  (cash-flow bar chart, deletable lines, target shown).
- **Standardized client milestones** (#61): `type_stages.milestone` (auto-map trigger
  `fn__default_milestone` + `fn_set_type_stage_milestone`); `building_milestones` view; milestone
  stepper on the building page.
- **Sales & payments** (#62, money path): tables `sales` / `payment_tranches` / `payments`;
  `fn_create_sale` / `fn_record_payment` / `fn_void_payment`; views `sale_payment_summary` +
  `payment_schedule` (waterfall + due). UI: `/sales`, `/sales/[id]`, `SalesManager`, `PaymentPanel`,
  nav item.
- **Portal v2 — two audiences + email** (#63): `portal_links.link_type/building_id/recipient_email`;
  `fn_create_portal_link` v2 (audience + email delivery); `fn_portal_view` buyer/partner branches
  (safe-columns-only preserved). UI: `PortalView` (two layouts), `PortalLinksPanel` create form.
- **Dashboard redesign**: portfolio hero + live Homes/Sold/Collected + "Portfolio by milestone".

**Tests added:** `archive`, `material_plan`, `planner_truecost`, `milestones`, `payments`,
`expense_building` (+ updates to `workdone_ev`, `ac9_overrun`, `m6_reorder_advice`, `ac13_portal`).
All registered in `scripts/verify_all.sh`.

---

## 5. Pilot area status (M8)

| Area | Status |
|---|---|
| 1 · Board & building ops | ✅ done (stamp, budget photo, log work, complete stage) |
| 2 · Materials store | ✅ done (IN/OUT, balances, procurement, variance) |
| 3 · Expenses & approvals | ✅ done (create/approve/void, building-tagged, breakdown) |
| 4 · Daily reports + photos | ⏸ **DEFERRED to the mobile phase** (no web surface) |
| 5 · Planner | ✅ done (true-cost fix + redesign + stage durations) |
| 6 · Client portal | 🟡 **built (v2)**, needs a pilot walk-through (buyer + partner links) |
| 7 · Ask + AI proposals | ⬜ not yet pilot-tested |
| 8 · Notifications / digest | ⬜ not yet pilot-tested |
| Break-it pass (12 attacks) | ⬜ pending — `docs/M8_PILOT.md` |

---

## 6. What's NEXT (the next phase)

1. **Founder eyeballs the new client surfaces on cloud** — dashboard, `/sales` (create a
   buyer + a partner, record a payment), a building's milestone stepper, and both portal views
   (create a Buyer link for PE009 + a Partner link, open each logged-out).
2. **MOBILE PHASE** — this unblocks the biggest remaining gaps:
   - `apps/mobile/` is a Flutter **scaffold** (M4-era: Drift offline store, outbox, sync,
     capture service). **Not runnable on this box** (no Flutter SDK) — needs a Flutter env.
   - Wire real auth (phone OTP → `ApiClient`), camera capture, media upload to `report-media`.
   - Build the **mobile "mark done" flow** (stage-led ticks, offline) — design agreed with the
     founder earlier this session (separate flows: progress ticks vs granular finance).
   - Then build the **in-web photo GALLERY** — the ONE deferred client piece. Photos are the #1
     client trust driver, but none exist yet (they come from the field app); the portal already
     shows the photo COUNT. Build the gallery (signed-URL thumbnails from the `report-media`
     bucket, per building + project) once real photos flow in.
3. **Finish web pilot testing:** Areas 6 (portal), 7 (Ask+AI), 8 (notifications) → the break-it
   pass → M8 exit gate (21 consecutive days of real reports).

---

## 7. Open items / known gaps / watch-list

- **Repo is PUBLIC on GitHub** → flip to private before wider use.
- **Revoke the exposed `sbp_…` access token** (flagged in earlier sessions — CLOUD_MIGRATION.md).
- **In-web photo gallery** — deferred (see §6).
- **Milestone order:** "Services" trails "Finishes" for Type B because the bill orders M&E at
  stages 14–15; reflects the recipe. Reorder those stages, or impose a fixed milestone rank, if
  you want the conventional order.
- **Phone OTP (Termii)** disabled (500'd) — email OTP is the web login path; fix for the field app.
- **PITR + restore drill (AC-16)**, **WhatsApp BSP application**, **processor DPAs** — all still
  pending for the real pilot (CLOUD_MIGRATION.md §Remaining Phase-0).
- **Notifications** currently write to `dev_outbox` (dev mode). Portal links queue an email/whatsapp
  row there; a production worker must actually send. Resend domain `noreply@leiko.app` is verified.

---

## 8. Golden rules (from CLAUDE.md — never break)

1. No client trusted with money — every money write goes through a `SECURITY DEFINER` fn;
   financial tables have NO client write policy. (Payments this session follow this.)
2. Every fact has a source + confidence.
3. AI proposes, humans dispose.
4. Quantity from the design, price from the market (cost computed live, never frozen).

RLS on every table; append-only financial records (void, never delete); test the dangerous
parts (RLS isolation, idempotency, money path). `verify_all.sh` must stay green.
