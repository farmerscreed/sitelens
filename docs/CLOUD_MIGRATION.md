# CLOUD_MIGRATION — things to do when moving local → managed Supabase

> Secrets (access tokens, service keys) NEVER go in this file or any git-tracked file —
> keep them in a local `.env` (git-ignored) only.

Local dev and managed cloud must differ ONLY in `.env` values (CLAUDE.md:
"portability is sacred"). This file lists everything that will need attention at
cloud-move time. Append as we go. Region target: managed Supabase, London
(`eu-west-2`) — PITR enabled, non-negotiable (PRD §5.1).

## Standing items (from M0)

- **Extensions on cloud.** `postgis`, `vector`, `pg_cron` must be enabled on the
  managed project (pgcrypto is default). They are in the first migration, but some
  managed setups require enabling `pg_cron` from the dashboard/`ALTER SYSTEM`.
- **pg_cron jobs.** Verify after restore. As of M7 there is one: `sitelens-weekly-digest`
  (Fri 06:00, `SELECT fn_run_weekly_digests()`), registered best-effort by
  `20260728010000_m7b_digest.sql`. Confirm pg_cron runs in the cloud DB and the schedule
  is in the org timezone (WAT). More nightly AI batch jobs (anomaly, etc.) land later.
- **Object storage adapter → R2.** Local uses Supabase Storage; production swaps to
  Cloudflare R2 (zero-egress, PRD §5.3). The **R2 bucket must be created** and its
  keys placed in `.env`. App code calls the storage interface only — no provider
  names in code.
- **Auth / OTP → Termii.** Local uses an auto-confirm / fixed-OTP shim. Production
  needs a **Termii API key** in `.env` and the phone-OTP provider wired behind the
  auth abstraction.
- **Notifications.** WhatsApp Business API, SMS, Resend email all behind the
  notifications abstraction with a dev-mode `dev_outbox`. Production needs live
  keys; **WhatsApp BSP application must be started early** (long lead time) — this
  is a human/external step, tracked here since M0.
- **AI router → OpenRouter.** `DEV_AI_MODE` returns stubs locally. Production needs
  an **OpenRouter key**; model choice stays config, never hardcoded (PRD §11.3).
- **JWT `active_org_id` claim.** RLS depends on `request.jwt.claims.active_org_id`.
  The token-issuance path (custom access-token hook / Edge Function) that injects
  `active_org_id` + `role` must be configured on cloud so real GoTrue tokens carry
  it. Until built, the AC-6 API test mints tokens with the local JWT secret.
- **PITR + restore drill.** Enable PITR on the managed project and perform a
  documented restore (SEC-12 / AC-16), quarterly.
- **DPAs / NDPA.** Execute Supabase, Cloudflare, Resend, Termii and inference-
  provider DPAs with SCCs; UK-storage disclosure in the privacy notice (SEC-1/2).

## Cloud deploy status (updated 2026-07-28)

- **Project:** `SiteLens` · ref `gwzpqnnwflwkcrowolgx` · region **eu-west-2 (London)** ·
  Postgres 17.6 · org `lawone`.
- **Schema pushed:** all 28 migrations applied. Verified: 44 SiteLens tables (RLS on every
  one; only PostGIS `spatial_ref_sys` without RLS, expected), 55 `fn_*` functions,
  `sitelens-weekly-digest` pg_cron job registered. pgcrypto in `extensions`, postgis/vector
  in `public`, pg_cron in `cron` — matches local.
- **Access token used for the push was exposed in chat → REVOKE it** (dashboard → Account
  → Access Tokens). Never store tokens here.

### Done on cloud (2026-07-28)
- [x] Schema: all 28 migrations. Storage buckets `boq-sources` + `report-media` (private).
- [x] **Edge functions deployed** (ACTIVE, verify_jwt=false — each does its own/DB auth):
      `storage-signed-url`, `ask`, `receipt-ocr`, `boq-extract-pdf`, `boq-parse`.
- [x] **Secrets set:** `OPENROUTER_API_KEY`, `DEV_AI_MODE=false`, `RESEND_API_KEY`.
      (Edge funcs auto-get SUPABASE_URL / ANON / SERVICE_ROLE.)
- [x] **Auth `custom_access_token` hook enabled** → real logins carry `active_org_id`.
- [x] `pg_cron` weekly digest registered.

### Update 2026-07-30 — CORS fix, price-delete migration, functions redeployed

- [x] **All 5 edge functions redeployed** with corrected CORS (`x-client-info`, `apikey`
      added to Access-Control-Allow-Headers) — was blocking BOQ upload + Ask from the Vercel
      origin. Note: MCP redeploy sets `verify_jwt: true` (fine; users authenticate) and the
      `_shared/ai-router.ts` import is flattened to `./ai-router.ts` in the deployed copy.
- [x] **Migration `20260730000000_price_delete`** applied → `fn_delete_material_price`
      (admin-only, audited). **30 migrations** total now.
- [ ] Next dedicated build: **BOQ intelligence** (see docs/BOQ_INTELLIGENCE.md) — AI stage
      assignment, price-list population from BOQ rates, conflict resolution.

### Update 2026-07-29 (later) — projects module

- [x] **Migration `20260729000000_projects_write_fns`** applied to cloud (now **29 migrations**):
      `fn_create_project` / `fn_rename_project` / `fn_archive_project` (SECURITY DEFINER,
      admin/PM only). Projects remain SELECT-only RLS. New-machine setup guide added:
      **docs/DEV_SETUP.md**. Email OTP length corrected 8→6 (`mailer_otp_length`).

### Update 2026-07-29 — web live, email login, org provisioned

- [x] **Provisioned org #1** Vantara International (founder auth id `…0002`, login
      biebele@gmail.com). Starter project/recipe/prices in place.
- [x] **Deployed `apps/web` to Vercel** → https://sitelens-eosin.vercel.app (auto-deploy on
      push to `master`). Full web reference: **docs/WEB_CONSOLE.md**.
- [x] **Login works via EMAIL OTP** (decision #37). Cloud auth uses **Resend SMTP**, sender
      **`noreply@leiko.app`** (leiko.app = verified Resend domain; account owner
      tawokels@gmail.com). Email rate limit raised to **100/hr**. NOTE: an unverified Resend
      sender only delivers to the account owner — a verified domain is required to email real
      pilot users/clients.
- [x] **`custom_access_token` hook** confirmed injecting `active_org_id` into real tokens.
- **Vercel Hobby committer rule:** deploys are BLOCKED unless the commit email is linked to a
      GitHub account. Commit as `29656494+farmerscreed@users.noreply.github.com` (see
      docs/WEB_CONSOLE.md §2).

### Remaining Phase-0 (before real data / pilot) — see docs/M8_PILOT.md
- [ ] Enable **PITR** + do a restore drill (SEC-12 / AC-16) — dashboard (may need a paid plan).
- [ ] **Phone OTP → Termii:** the `send-sms` hook 500'd and is DISABLED. Email OTP is the web
      login path meanwhile (decision #37); fix Termii for the Flutter field app.
- [ ] **Verify a Resend domain sender** so OTP/notifications reach any client (not just the
      Resend account owner). leiko.app is verified; keep sender on it.
- [ ] Paste `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` / DB password into local `.env`
      (for admin scripts / running the test suite against cloud). — done in `.env`.
- [ ] Build `apps/mobile` for cloud.
- [ ] R2 is OPTIONAL for the pilot (Supabase Storage works); swap later for zero-egress.
- [ ] Execute processor DPAs/SCCs before real personal data (SEC-1); start WhatsApp BSP.
- [ ] **Revoke the `sbp_…` access token** used for the push (exposed in chat) — STILL PENDING.

### Provisioned (2026-07-28)
- **Org #1: Vantara International** (id `10000000-…-0001`). Admin = the founder, login by
  phone OTP (Termii). Starter data: project "Pilot Estate" (6 buildings), recipe "Terrace
  Type A" (5 stages, BOQ items), dated price list, budget line. All swappable in-app.
- **Edge fns incl. `send-sms`** deployed; **phone auth + Termii send-sms hook enabled**.
- **Repo:** github.com/farmerscreed/sitelens (private). Web deploy = import to Vercel with
  Root Directory `apps/web` + NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY.

## 2026-07-30 — BOQ true-cost build applied to cloud (Phases 0–3 + bootstrap)

- **5 migrations applied to `gwzpqnnwflwkcrowolgx` via MCP `apply_migration`**
  (cloud ledger names): `boq_confirm_fixes`, `boq_staging_v2`, `truecost_core`,
  `workdone_ev`, `boq_bootstrap_progress`. Local tree = **35 migration files**;
  the cloud ledger is shorter because the pre-cutover schema was pushed in bulk —
  verify parity by schema (tables/fns), not by ledger count.
- **`boq-extract-pdf` redeployed 3×** (extraction v2 → parallel-enrichment fix →
  progress reporting). Deploy from this box:
  `~/.local/bin/supabase functions deploy boq-extract-pdf --project-ref gwzpqnnwflwkcrowolgx --use-api`
  (CLI is logged in; `link` would need the DB password — not required with
  `--project-ref`). Ships `_shared/ai-router.ts` + `_shared/boq_core.mjs` with it.
- Secrets in use: `DEV_AI_MODE=false`, `OPENROUTER_API_KEY` set, `AI_BOQ_MODEL`
  unset (defaults to anthropic/claude-sonnet-5 via OpenRouter).
- At any future cloud move: re-apply all 35 migration files in order (they are the
  single source of truth), redeploy all 6 edge functions, re-set the secrets above.
