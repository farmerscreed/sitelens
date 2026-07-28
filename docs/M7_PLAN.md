# M7 plan — Client portal + notifications + weekly digest

> Milestone flipped M6→M7. Building through. The portal security model (token+PIN, no
> user auth, no financial leakage) is the AC-13 gate — fully DB-verified.

## Gate (AC-13)
A client opens the portal with **link + PIN, no account**; the link is **revocable**; and
**every access is logged**. Plus SEC-11: token hashed at rest, PIN required, per-recipient
revocation. F-13.6: never exposes supplier names, unit prices, or worker data.

## PRD basis
§9 F-13 (portal), §16.3 ("reads through a token-keyed SECURITY DEFINER function, never
authenticates as a user"), §14 SEC-11, §5.4 (email), §11.4 AI-4 (weekly digest) / AI-5
(anomaly). `portal_links`/`portal_access_log` tables exist (M0). Notifications behind an
abstraction with a dev-mode outbox (CLAUDE.md).

## Workstreams
- **A — portal backend:**
  - `fn_create_portal_link(project, recipient, show_line_items, expiry_days)` — Admin/PM;
    generates a token (returned once) + 6-digit PIN; stores **`token_hash` (sha256)** +
    **`pin_hash` (bcrypt via pgcrypto)**; notifies the recipient.
  - **`fn_portal_view(token, pin, ip, ua)`** — SECURITY DEFINER, **granted to `anon`**
    (the portal never authenticates as a user). Hashes the token, rejects
    revoked/expired, verifies the PIN, **logs every access** (`portal_access_log`, with
    `pin_success`), and returns a **safe** JSON view: overall progress, milestone/stage
    counts, photo timeline, **summary** spend vs budget (line items only if
    `show_line_items`), overdue — and **never** supplier names, unit prices, or worker
    data (F-13.6).
  - `fn_revoke_portal_link` / `fn_renew_portal_link` (Admin/PM).
- **B — notifications:** `dev_outbox` table + `fn_notify(org, channel, recipient,
  template, payload)` (dev-mode writes to the outbox; same interface as production which
  swaps to WhatsApp/SMS/Resend). Portal creation + digest send through it.
- **C — weekly digest (AI-4) + anomaly (AI-5):** `fn_project_weekly_summary(project)`
  (structured week figures: reports, spend, overruns, low stock), `fn_spend_anomaly`
  (expenses this week vs trailing average → flag), `fn_run_weekly_digests()` (writes a
  digest notification per active project). A **`pg_cron`** job schedules it. LLM prose is
  a DEV_AI_MODE polish in an edge fn; the numbers come from the DB.
- **D — tests:** `ac13_portal` (link+PIN opens; wrong PIN rejected+logged; revoke blocks;
  expiry blocks; access logged; no supplier/price/worker fields in the view), `m7_notify`
  (fn_notify → dev_outbox; weekly summary + anomaly + run_weekly_digests writes digests).
- **E — UI:** the **public portal page** `app/portal/[token]` (PIN entry → view), a
  portal-link management panel in the console (create/revoke, last-opened), and a
  dev-outbox/notifications view.

## Files
```
supabase/migrations/2026…_m7a_portal.sql    dev_outbox, fn_notify, fn_create/portal_view/revoke/renew
supabase/migrations/2026…_m7b_digest.sql    fn_project_weekly_summary, fn_spend_anomaly, fn_run_weekly_digests + pg_cron
supabase/tests/ac13_portal.sql, m7_notify.sql
apps/web/app/portal/[token]                 public PIN-gated view; app/portal manage links; notifications view
```

## Verification
`bash scripts/verify_all.sh` + `ac13_portal`, `m7_notify`; all prior suites green.

## Decisions (noted, recommended)
1. **Token hashed with sha256, PIN with bcrypt (pgcrypto `crypt`/`gen_salt('bf')`).**
   Token is a bearer secret (fast hash fine); the 6-digit PIN is low-entropy so bcrypt's
   slowness resists guessing. Both stored hashed at rest (SEC-11).
2. **`fn_portal_view` is the ONLY portal read path and is granted to `anon`.** It is
   SECURITY DEFINER and hand-selects safe columns, so it structurally cannot leak
   supplier/price/worker data even though it bypasses RLS.
3. **Digest numbers come from SQL; LLM prose is optional (DEV_AI_MODE).** Keeps the gate
   deterministic and the feature useful with no paid key.
