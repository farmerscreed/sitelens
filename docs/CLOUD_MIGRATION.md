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

### Remaining Phase-0 (before real data / pilot) — see docs/M8_PILOT.md
- [ ] Enable **PITR** + do a restore drill (SEC-12 / AC-16).
- [ ] Create **R2** buckets (`boq-sources`, `report-media`); set STORAGE_PROVIDER=r2 + keys.
- [ ] Deploy edge functions (`boq-parse`, `boq-extract-pdf`, `storage-signed-url`,
      `receipt-ocr`, `ask`); set their secrets; DEV_AI_MODE=false + OpenRouter key.
- [ ] Enable the `custom_access_token` auth hook on cloud; switch OTP to **Termii**.
- [ ] Set `.env` for `apps/web` (URL + anon key) and deploy; build `apps/mobile` for cloud.
- [ ] Execute processor DPAs/SCCs before real personal data (SEC-1); start WhatsApp BSP.
