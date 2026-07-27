# CLAUDE.md — SiteLens build standing orders

You are building **SiteLens**, a construction planning, management and monitoring platform for Nigeria. The full specification is in `/docs/PRD.md`. **Read it before writing code.** This file holds the rules that must never drift between sessions. If anything you are about to do conflicts with this file, stop and ask.

---

## ACTIVE MILESTONE

> **Currently building: M3 — Feasibility planner (funding-required, then max-delivery), scenarios.**
> M0 (AC-6), M1 (AC-5/AC-7), M2 (58-building board gate) all passed — see docs/STATUS.md. Do not build ahead of this line. When M3's gate passes, the human updates this line to M4.

You work on **one milestone at a time** (M0…M8, defined in PRD §17). Never scaffold future milestones "to save time." Never start the next milestone until the human confirms the current one's acceptance gate has passed.

---

## THE FOUR GOLDEN RULES (inviolable)

1. **No client is trusted with money.** Every write touching an expense, material transaction, price, budget, or BOQ commit goes through a Postgres `SECURITY DEFINER` function or an Edge Function — **never a direct insert/update from the app or a client-side Supabase call.** Financial and price tables have **no** INSERT/UPDATE/DELETE RLS policies; the only write path is the server function.
2. **Every fact has a source and a confidence.** Any observable value (headcount, quantity, progress, extracted BOQ row) stores `source`, `confidence`, `model_id`, `verified_by`. Never add a value column without them.
3. **AI proposes, humans dispose.** No model output (BOQ extraction, anomaly, reorder advice, feasibility result) is ever committed automatically. It is a proposal a human confirms, or a discrepancy a human explains.
4. **Quantity comes from the design; price comes from the market.** Material quantities live on the recipe (`type_boq_items`) and never carry a price. Prices live in the dated `material_prices` list. Cost is always `quantity × current_price`, computed live — never stored frozen.

---

## STOP AND ASK

The PRD is detailed but cannot cover everything. When you hit a gap, **do not guess and proceed.** Stop and ask the human when you are about to:

- choose an architecture, library, or pattern the PRD did not specify;
- change the database schema in a way not in `/docs/PRD.md`;
- decide how offline conflict resolution behaves for a new record type;
- add any third-party service or dependency not listed in the stack;
- work around something because "it's easier" — easier is not a reason to deviate from the four rules.

A wrong guess in RLS, offline sync, or the money path is expensive to unwind. Asking is cheap.

---

## STACK (do not substitute without asking)

- **Database / backend:** Supabase (Postgres 15+). Extensions: `postgis`, `vector` (pgvector), `pg_cron`, `pgcrypto`.
- **Local dev:** self-hosted Supabase in Docker via the **Supabase CLI** (`supabase start`). This is the current environment. Cloud (managed Supabase, London / `eu-west-2`) comes later.
- **Mobile:** Flutter, Android 8+ target, Drift (SQLite) for the offline store.
- **Web:** Next.js + Tailwind (command console + client portal).
- **Auth:** Supabase Auth, phone OTP (Termii in production — see local shims below).
- **Object storage:** abstracted (see portability). Local = Supabase Storage; production = Cloudflare R2.
- **AI:** all LLM calls go through **OpenRouter** behind a router abstraction — model choice is config, never hardcoded (PRD §11.3).
- **Notifications:** WhatsApp Business API (primary), SMS, push, Resend email — all behind an abstraction with a dev-mode that logs instead of sending.

---

## LOCAL-FIRST, CLOUD-LATER — PORTABILITY IS SACRED

Everything must move from local Docker Supabase to managed cloud Supabase with **zero code changes** — only config. Enforce this:

- **All schema changes are migrations.** Use `supabase migration new <name>` and write SQL migration files under `/supabase/migrations`. **Never** change the database by hand in Studio — hand changes don't migrate to cloud and destroy reproducibility. If it isn't in a migration file, it doesn't exist.
- **Test the full reset works:** `supabase db reset` must rebuild the entire database from migrations + seed every time. If it doesn't, the migrations are broken — fix before moving on.
- **No hardcoded URLs, keys, ports, or bucket names.** Everything comes from environment variables. Local and cloud differ only in the `.env` values.
- **Storage behind an adapter.** Define one storage interface (`put`, `getSignedUrl`, `delete`). Local implementation uses Supabase Storage; production swaps to R2. App code calls the interface, never a provider directly.
- **The three-derivative photo rule still applies locally** (thumb / display / original — PRD §5.3). Do not shortcut it in dev; the pipeline must be real from the start.
- Keep a `/docs/CLOUD_MIGRATION.md` and append to it whenever you do something that will need attention at cloud-move time (e.g. "R2 bucket must be created", "Termii key required", "pg_cron jobs to re-register").

---

## LOCAL DEVELOPMENT SHIMS (so you don't need real external services yet)

You must be able to build and test M0–M6 without live WhatsApp, SMS, email, or paid AI keys. Build these in from the start:

- **OTP / auth:** in dev, use a fixed test OTP or Supabase auto-confirm. Never require a real SMS to log in locally.
- **Notifications (WhatsApp/SMS/email):** dev mode writes the message to a `dev_outbox` table and/or the console instead of calling the provider. Same interface as production.
- **AI calls:** support a `DEV_AI_MODE` that returns canned/stub responses for tests, and only hits OpenRouter when a real key is present. Never block a build on an AI key.
- **Never call a paid or rate-limited external API from an automated test.**

---

## DATABASE RULES

- **RLS is enabled on every table**, no exceptions. This is how PRD acceptance criterion AC-6 (org A cannot read org B) is satisfied — by the database, not by application code.
- SELECT policies gate on `current_org_id()` / `has_project_access()`. Financial, price, and BOQ-commit tables get **no write policies** — writes go through server functions only (Rule 1).
- Every user-generated / mutation table has a client-generated **UUIDv7** primary key and a unique **`idempotency_key`** (PRD §13.2). This is what stops offline retries duplicating financial records. Do not omit it.
- All money columns are `NUMERIC`, never float. All timestamps are `TIMESTAMPTZ`. Business dates are computed in the org timezone (WAT, UTC+1), never derived from a UTC timestamp (PRD NF-11/12).
- Financial records are **append-only**: never edited, only voided (`voided_at`, `voided_by`, `void_reason`). Foreign keys on financial data use `ON DELETE RESTRICT`, never `CASCADE`.
- Write an RLS isolation test as part of M0 and keep it green: a user of org A must be unable to read any row of org B by any route — tested against both the API and the database directly.

---

## SECURITY

- **Secrets never enter code, migrations, chat, or git.** All keys (Supabase, OpenRouter, Termii, Resend, R2) live in `.env` files that are git-ignored. Provide a committed `.env.example` with blank keys.
- Signed URLs for media expire in 15 minutes; object keys are opaque UUIDs, never containing project or building names.
- No biometric data anywhere — no face recognition, templates, or gait, ever (PRD SEC-9). Attendance is anonymous headcount + optional QR badge only.

---

## HOW TO WORK

- **Plan before you build.** For each milestone, first propose the files you'll create/change and the approach, and wait for a go-ahead. Don't generate 40 files unprompted.
- **Small, reviewable commits.** One logical change per commit, clear message.
- **Match the PRD's IDs.** When you implement `F-BOQ-3` or `AC-6`, reference the ID in the commit/PR so work is traceable to the spec.
- **A task is done when its acceptance criterion passes**, not when the code runs. Code that runs can still trust the client with money. State which AC you believe is satisfied and how you verified it.
- **Tests for the dangerous parts:** RLS isolation, idempotency/no-duplicate-on-retry, material balance never going negative, price change re-costing correctly, offline sync. These are non-negotiable test targets.
- **Keep `/docs/DECISIONS.md`** — a short running log of any judgment call you made where the PRD was silent, so the human can review drift.

---

## WHAT NOT TO DO

- Do not build billing, self-service signup, account administration, per-customer branding, or the rough-materials "side door." All deferred `[LATER]` (PRD §3.2). The founder is organisation #1.
- Do not use `localStorage`/`sessionStorage` or any browser storage in a way that breaks offline-first; the mobile source of truth is Drift/SQLite.
- Do not add real-time/Socket.io — not in scope (polling + push only).
- Do not compress photo originals; keep full-resolution originals (PRD §5.3).
- Do not change the database outside a migration file.
- Do not proceed past the ACTIVE MILESTONE line.

---

## FIRST TASK (M0)

Propose (don't yet execute) a plan to:
1. Initialise the Supabase CLI project and local Docker stack, with the required extensions.
2. Create the initial migration implementing the full v3 schema from PRD §16, with RLS enabled on every table.
3. Stand up the `SECURITY DEFINER` helper functions (`current_org_id`, `current_membership_id`, `has_project_access`, `current_price`).
4. Write the RLS isolation test (org A cannot read org B).
5. Confirm `supabase db reset` rebuilds everything cleanly.

Show me the plan and the file list first. Wait for go-ahead before writing.
