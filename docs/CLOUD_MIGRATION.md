# CLOUD_MIGRATION — things to do when moving local → managed Supabase

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
