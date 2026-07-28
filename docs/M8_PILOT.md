# M8 — Pilot runbook (the real gate)

> M8 is not a feature build. It is running SiteLens on the founder's own buildings for
> **21 consecutive days of real reports**, with someone actively trying to defeat it.
> "What they find is worth more than another month of features" (PRD §17). This runbook
> is the plan: cloud cutover → provision org #1 → the 21-day run → the adversarial
> break-it pass → the exit gate.

**Exit gate (M8 passes when):**
1. 21 consecutive days of real daily reports from the live site, and
2. the break-it pass (below) is executed and every finding is triaged (fixed or
   consciously accepted), and
3. the not-yet-live acceptance criteria (AC-2, AC-14, AC-16) are confirmed on real usage.

---

## Phase 0 — Cloud cutover (day −3 to day 0)

Everything so far ran on local Docker Supabase. The pilot runs on **managed Supabase,
London (`eu-west-2`)**. Portability was kept sacred, so this is config, not code. Work
through `docs/CLOUD_MIGRATION.md` alongside this.

- [ ] **Create the managed project** (London). **Enable PITR — non-negotiable** (SEC-12).
- [ ] **Extensions:** confirm `pgcrypto`, `postgis`, `vector`, `pg_cron` enabled on cloud
      (some need dashboard enablement). Note pgcrypto is in the `extensions` schema — the
      portal functions already use `search_path = public, extensions`.
- [ ] **Push migrations:** `supabase link` then `supabase db push` (all 28). Do NOT hand-
      edit in Studio — migrations only.
- [ ] **Re-register pg_cron:** confirm `sitelens-weekly-digest` exists; set the schedule
      in the org timezone (WAT, UTC+1).
- [ ] **Storage → R2:** create the Cloudflare R2 buckets (`boq-sources`, `report-media`),
      set `STORAGE_PROVIDER=r2` + R2 keys in env, wire the R2 arm of `lib/storage`.
      Keep the three-derivative rule (thumb/display/original).
- [ ] **External keys (env only):** Termii (phone OTP), OpenRouter (`DEV_AI_MODE=false` +
      key), Resend on `notify.<domain>` (DKIM/SPF/DMARC per §5.4), WhatsApp BSP.
      **Start the WhatsApp BSP application NOW — it has a long lead time.**
- [ ] **Deploy edge functions:** `boq-parse`, `boq-extract-pdf`, `storage-signed-url`,
      `receipt-ocr`, `ask`. Set their secrets (SUPABASE_*, OPENROUTER_API_KEY).
- [ ] **Auth:** enable the `custom_access_token` hook on cloud; switch OTP from the dev
      test-code to Termii; execute the DPAs/SCCs (SEC-1) before real personal data lands.
- [ ] **Web app:** deploy `apps/web` with cloud `.env` (URL + anon key). **Mobile:** build
      `apps/mobile` in a Flutter env, point at cloud, sideload/Play-internal to the pilot
      phones.
- [ ] **Restore drill (AC-16):** perform and document a PITR restore before real data —
      prove the recovery path works while the stakes are zero.

## Phase 1 — Provision org #1 (day 0)

The founder is organisation #1 (build-for-one). No self-service signup (that's `[LATER]`).

- [ ] Create the org; add the founder (admin), the PM(s), and the site engineer(s) as
      memberships with the right roles. Verify each logs in via phone OTP and lands in the
      right org (the A0 hook injects `active_org_id`).
- [ ] Digitise the **real recipes** (types → stages → BOQ items via Excel/PDF import),
      set the **real price list**, define **budget lines** per project.
- [ ] Stamp the **real buildings** into phases/batches; confirm the board shows them.
- [ ] Issue **client portal links** to the actual owner(s); confirm they can open with the
      PIN and see only safe data.

## Phase 2 — The 21-day run

- **Engineer, daily (mobile, offline-first):** daily report < 90 s (AC-14, measured
  in-product), 3–20 in-app photos, log material IN/OUT, mark stage progress, attendance
  headcount. Reports created offline, synced on reconnect.
- **PM, daily (web/mobile):** approve/reject reports & expenses, watch the board, manage
  batches, resolve amendments.
- **MD, weekly (web):** the board, the feasibility planner, the Friday WhatsApp digest.
- **Instrument it:** watch `dev_outbox`/notifications, `ai_inferences` (proposals vs
  accepted → the flywheel), `audit_log` (every void/approval/price change/overrun/batch
  advance), and report-completion timing.

---

## The break-it pass (the point of M8)

Assign someone (ideally not the builder) to actively attack the system. Each attack maps
to a Golden Rule / acceptance criterion; the expected defence is already built and unit-
tested — the pilot confirms it holds against a real human on real hardware.

| # | Attack (try to…) | Golden rule / AC | Expected defence | Verify |
|---|---|---|---|---|
| 1 | Double-log a delivery / resubmit a report over flaky 3G | Rule 1 / AC-1 | idempotency_key → resend is a no-op | one txn/report; check `audit_log`, balances |
| 2 | Drive material stock negative (log OUT > on hand) | Rule 1 / AC-4 | `fn_log_material_txn` FOR UPDATE + reject | OUT refused; balance unchanged |
| 3 | Record a big expense as "spent" without sign-off | Rule 1 / AC-11 | status `pending` until an authorised approver | engineer can't approve; >₦250k needs Admin |
| 4 | Edit/insert money directly from the client (devtools) | Rule 1 | no write RLS policy on money/price/BOQ tables | direct write denied; only `fn_*` path works |
| 5 | Read another org's data by any route | AC-6 | RLS on every table | 0 rows cross-org (rerun `rls_isolation`) |
| 6 | Reuse an old/borrowed photo | AI-1 / AC-3 | perceptual-hash near-dup flag (90 d) | resubmitted photo flagged `duplicate_of` |
| 7 | Fake a report from off-site | F-9.5 | geofence flag on photos → PM approval | photo `within_geofence=false`, report flagged |
| 8 | Backdate a report to hide a gap | F-9.2 | backdating > 3 days rejected | submit refused |
| 9 | Claim a stage done while under-consuming BOQ | §10.4 / AC-9 | overrun/underrun flag at completion | `stage_overrun` audit; req-vs-actual view |
| 10 | Forward a portal link without the PIN | F-13.2 / SEC-11 | PIN required; every attempt logged | rejected; `portal_access_log` has the attempt |
| 11 | Change a price to rewrite history | Rule 4 / AC-7 | prices are dated, append-only | old reports unchanged; new cost re-computed |
| 12 | Auto-commit an AI extraction/anomaly | Rule 3 | AI proposes, human disposes | nothing commits without `fn_resolve_inference` |

Log every finding as an issue; fix or consciously accept each before declaring M8 passed.

## Acceptance criteria — live confirmation

Most AC-x are already proven in `supabase/tests/` (rerun on cloud with
`scripts/verify_all.sh` equivalent). The pilot must additionally confirm the ones that
only real usage can show:
- **AC-2** — every photo has a watermarked `display` + an untouched `original` (EXIF
  intact). Verify against real captures through the R2 pipeline.
- **AC-14** — median daily-report completion **< 90 s** across pilot users (measured
  in-product).
- **AC-16** — PITR enabled and a restore performed + documented (do in Phase 0).
- **AC-15** — spot-check: no biometric data anywhere (permanent constraint, SEC-9).

## After the pilot
Triage findings → fix the dangerous ones → only then consider the `[LATER]` list (billing,
self-service signup, the rough-materials side door, P2 cameras). The dataset accumulated
during the pilot (labelled photos tied to verified transactions tied to BOQ) is what makes
the P2/P3 camera work possible — protect it.
