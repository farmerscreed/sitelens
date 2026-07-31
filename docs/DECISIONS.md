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

9. **`UNIQUE (org_id, lower(...))` table constraints rewritten as unique indexes.**
   The PRD's own SQL for `materials_catalog` and `material_aliases` used an inline
   `UNIQUE (org_id, lower(name))` table constraint. Postgres rejects expressions in
   a UNIQUE constraint (`syntax error at or near "("`) — `db reset` failed on it.
   Rewrote both as `CREATE UNIQUE INDEX ... (org_id, lower(...))`, same intent
   (case-insensitive uniqueness per org). This is a bug in the PRD SQL that only
   surfaced by actually running the migration.

10. **`spatial_ref_sys` is the one public table without RLS — intentionally.** It is
    PostGIS's static coordinate-system reference table (EPSG codes, no tenant data),
    created by `CREATE EXTENSION postgis`. Enabling RLS on an extension-owned table
    risks breaking extension upgrades, and Supabase's own linter treats it as a
    known exception. All 41 SiteLens domain tables have RLS enabled.

11. **`anon` gets NO table SELECT grant; only `authenticated` does.** Tighter than
    RLS-alone: `anon` is blocked at the privilege layer, not just filtered by
    policy. The client portal reads via a token-keyed SECURITY DEFINER function,
    never as `anon` directly, so `anon` needs no table access. The AC-6 DB test
    accepts "anon blind" via either 0 rows (RLS) or permission-denied (no grant).

12. **Local verification worked around a Docker restriction in this environment.**
    This box's Docker daemon refuses `stop`/`kill`/`rm` on ANY container
    (`permission denied`), so `supabase db reset` and `supabase start` (which
    recreate the DB container) cannot complete here. We verified M0 instead by:
    (a) wiping `public` and re-applying all migrations + seed via
    `docker exec ... psql` against the running `supabase_db_sitelens` container —
    proving a clean build; (b) running the direct-DB AC-6 test the same way; and
    (c) launching a standalone PostgREST container (`sitelens_rest_manual`) on the
    supabase network, connected as the non-superuser `authenticator` role, and
    running the API AC-6 test against it. On a machine WITHOUT this Docker
    restriction, `supabase db reset` + `scripts/verify_m0.sh` run directly.
    (Authenticator password was set to 'postgres' via `supabase_admin` for the
    manual PostgREST; `postgres` is not the superuser in Supabase — `supabase_admin`
    is.)

13. **`rls_isolation.sql` details forced by psql autocommit + role privileges.** The
    matrix temp table drops the `ON COMMIT DROP` clause (psql autocommits each
    statement, which would drop it before the INSERT) and is read into plpgsql
    arrays BEFORE `SET ROLE authenticated` (a postgres-owned temp table isn't
    readable as `authenticated`).

## M1

14. **`type_boq_items` left exactly as the PRD defines it (no provenance columns).**
    Rule 2 (source/confidence/model_id/verified_by on observable values) is satisfied
    on `boq_import_rows` (which carries `confidence`); the confirmed recipe quantity in
    `type_boq_items` is a human-confirmed design value, and PRD §16 gives it no such
    columns. Confirmed with the founder before building M1 — no schema change.

15. **Unique index `material_prices(org_id, material_id, effective_from)`.** Added in
    workstream A so `fn_set_material_price` can upsert a *same-date* correction and so
    `current_price()` is deterministic (one price per material per date). A same-date
    call updates that date's row; it never rewrites a *different* date's history, so the
    "prices are append-only / old reports unchanged" intent (F-PRICE-2/AC-7) holds.

16. **A0 auth model: `active_org` table + `custom_access_token_hook`.** The PRD says the
    JWT carries `active_org_id` (§5.2) but not how. Chosen mechanism: a per-user
    `active_org` row (which org they're acting as); a Supabase custom-access-token hook
    injects `active_org_id`/`user_role`/`membership_id` at token issue, defaulting to the
    user's earliest active membership if none set; `fn_set_active_org` switches it (then
    the client refreshes its session); `fn_my_orgs` (SECURITY DEFINER) lets a user
    enumerate switchable orgs past the org-scoped `memberships` RLS. Dev logins use a
    fixed phone-OTP test code (no real SMS).

## M2

17. **Stage completion is web-driven in M2; mobile field capture wraps the same
    `fn_complete_stage` in M4.** F-BOARD-4 describes the engineer marking a stage from
    the field (mobile), but the Flutter app is an M4 deliverable. Confirmed with the
    founder: a PM/engineer marks & approves from the web now; the board gate is met
    web-side, no premature mobile work.

18. **Requirement-vs-actual: required (recipe) side in M2, actual + overrun flag in
    M5.** The "actual" needs material consumption (material OUT tagged to building+
    stage), an M5 deliverable. M2 shows required materials for completed stages and
    leaves a clean seam; F-BOARD-5's overrun flag wires in with M5. Confirmed.

19. **`board_view` uses `security_invoker = on`.** On PG15+ a view evaluates underlying
    RLS as the view owner by default; `security_invoker` makes it evaluate as the
    querying user, so org isolation still holds through the board. Board column is
    derived from `current_stage_id` + building status ('Not started' / stage name /
    'Done').

20. **Building version is stamped by FK, automatically.** `fn_create_buildings` sets
    `buildings.building_type_id` to the specific version row passed in. Since
    `fn_new_type_version` creates a NEW `building_types` row, existing buildings keep
    pointing at their original version — F-TYPE-4 holds with no extra bookkeeping.

## M3

21. **"Peak funding requirement" is ambiguous — we return both.** The PRD's peak could
    mean the max single-period cash need (which drops when you stagger, F-PLAN-4) or the
    max cumulative capital outstanding, net of inflows. `fn_compute_feasibility` returns
    `peak_period_requirement` AND `peak_funding`; the UI shows both. If the founder wants
    one headline number, it's a one-line change. Without inflows, `peak_funding` == total
    (cumulative spend is monotonic), which is correct.

22. **Feasibility model: quantity is a multiplier, not a per-building loop.** The engine
    places each plan_line's stages on a timeline once per (type, batch) and multiplies by
    the line quantity, so a 300-building plan is O(lines × stages) — trivially inside
    NF-13's 5 s. Stage duration = `ceil(expected_days / period_days)` (default 1 period);
    a stage's whole cost lands in the period it starts. Assumptions JSONB holds
    `period_unit`/`period_days`/`batches{hint:{start}}`; inflows are `[{period, amount}]`.
    Only inputs are stored — results are always recomputed live (F-PLAN-6).

## M4

23. **Media derivatives generated on-device (upload 3), not server-side.** Bandwidth
    (NF-6 < 15 MB/day) + offline viewing + thumbs-first (§13.4) favour the phone
    generating thumb/display locally; the original is copied byte-for-byte (never
    re-encoded — §5.3). `fn_register_media` just stores the keys + flags. Server/edge
    derivative generation from the original is a later option.

24. **AC-1 verified at the sync-protocol layer; Flutter is scaffolded, not built.** The
    no-duplicate guarantee is the server behaviour: `fn_submit_daily_report`/
    `fn_register_media` are idempotent (idempotency_key / client id), so a resend after a
    lost ack is a no-op. `ac1_offline_sync.sql` proves it (submit → retry same key → one
    row). The Flutter app (`apps/mobile/`) is code-complete but not built here (no SDK);
    it mirrors the verified server contract.

25. **`phash` duplicate flag is a basic EXACT match in M4.** `fn_register_media` flags a
    photo whose 64-bit hash exactly matches another in the same project within 90 days;
    the phone computes an aHash. Full perceptual near-duplicate detection (AI-1) is M6 —
    the column + flag path exist now so no schema change is needed then.

26. **Daily-report geofence flag lives on the photo, not the report.** Per PRD the
    report has no `within_geofence` column; `fn_register_media` computes it per photo
    (`ST_DWithin` vs the project's centroid/radius). A report with flagged photos is what
    triggers PM approval (F-9.5). Backdating > 3 days is rejected outright (F-9.2).

## M5

27. **Expense thresholds in `organizations.settings.expense_thresholds` (JSONB),** default
    `{pm: 50000, admin: 250000}`. Per-org configurable with no schema change:
    `fn_approve_expense` requires PM/Admin, and Admin specifically for amounts over the
    admin threshold; engineers can't approve. Unapproved = `pending` (committed, not
    spent) — AC-11.

28. **Balance is guarded by a `FOR UPDATE` row lock, never recomputed on read (AC-4).**
    `fn_log_material_txn` locks the `material_balances` row (creating it at 0 if absent),
    rejects an OUT that would go negative, and is idempotent on `idempotency_key` so an
    offline resend never double-counts. `fn_void_material_txn` reverses under the same
    lock and refuses a reversal that would go negative. **OUT requires a building tag** so
    requirement-vs-actual is always computable.

29. **Overrun "flag" = an audit_log entry at completion + the live
    `building_req_vs_actual` view** (PRD §10: "mostly query logic, not new tables").
    `fn_complete_stage` computes used-vs-required for the completed stage and writes a
    `stage_overrun` audit row "at the pour" (AC-9); the view shows consumed/required/
    overrun live on the building card. A dedicated discrepancies table can come later.

## M6

30. **Duplicate photo = Hamming distance ≤ 8 of 64 bits within 90 days (no model).**
    `fn_phash_hamming` counts differing bits (XOR then count '1's); `fn_register_media`
    flags the closest earlier photo within threshold + window as `duplicate_of`. Exact
    match (M4) missed real resubmissions (re-encoding shifts a few bits); a small
    threshold catches them with low false positives (AC-3). Full aHash is computed
    on-device (M4 capture service).

31. **Reorder advice is total-remaining (recipe − consumed − stock), not yet
    schedule-weighted.** The gate is "matches remaining BOQ", which this satisfies
    exactly (AC-9 test: required 200 − consumed 50 − stock 30 = order 120). The
    batch-schedule weighting ("300 bags by slab in 2 weeks") is a refinement layering on
    M2 batches + M3 timing later.

32. **Every AI output is an `ai_inferences` proposal a human disposes (Rule 3, §11.2).**
    `fn_record_inference` writes `proposed` with confidence/cost_estimate;
    `fn_resolve_inference` sets accepted/rejected and stores `human_value` — the
    corrected truth becomes the training label (the flywheel). OCR/reorder/answers never
    auto-commit. AI-3 (photo quality gate) is on-device and deferred to the Flutter build.

33. **AI vision/LLM calls go through the OpenRouter router with `DEV_AI_MODE`.**
    `extractReceipt`/`embed`/`answer` return deterministic stubs in dev (no paid key, no
    external call in tests); model ids are env config, never hardcoded (§11.3). Edge fns
    `receipt-ocr` and `ask` are code-complete (not run on this box).

## M7

34. **`fn_portal_view` RETURNS errors, never RAISEs.** A `RAISE` inside the function
    would roll back the access-log INSERT along with the failing call, so failed PIN
    attempts wouldn't be recorded. Returning `{error: …}` keeps the log (F-13.5/SEC-11).
    It is SECURITY DEFINER, granted to `anon` (the portal never authenticates as a user),
    and hand-selects only safe columns — structurally no supplier/price/worker leak.

35. **Token hashed sha256, PIN bcrypt (`crypt`/`gen_salt('bf')`).** Both stored hashed at
    rest (SEC-11); the token+PIN are returned once at creation. **pgcrypto lives in the
    `extensions` schema** in Supabase, so the portal functions use
    `search_path = public, extensions` (else `gen_random_bytes`/`digest`/`crypt` aren't
    found).

36. **Notifications go through `dev_outbox` + `fn_notify` in dev.** Same interface as
    production (which swaps to WhatsApp/SMS/Resend); nothing external is called in tests.
    The weekly digest (`fn_run_weekly_digests`) is scheduled with **pg_cron** (Fri 06:00),
    registered best-effort so `db reset` never breaks if scheduling is unavailable — must
    be verified after the cloud move (noted in CLOUD_MIGRATION.md).

## M8 — cloud pilot / web console (PRD was silent on these ops choices)

37. **Web console login = email OTP (not phone).** PRD assumed phone OTP (Termii). During
    cloud cutover the Termii `send-sms` auth hook 500'd on every request, blocking all
    logins. Email OTP via Resend SMTP is simpler and has no SMS-provider dependency, so the
    web console uses **email** as the primary path; phone OTP stays in the code for the
    Flutter field app (where a phone number is the natural identity) and is re-enabled when
    Termii is sorted. The login page offers both Email (default) + Phone tabs. This does not
    touch the Golden Rules — auth identity is orthogonal to the money/RLS path. Cloud sender
    is `noreply@leiko.app` (the verified Resend domain); an unverified Resend sender only
    delivers to the account owner, so a verified domain is required to email real users.

38. **Interactive controls in a Next.js server component MUST be client components.**
    Passing an inline `onChange` to a `<select>` from a server component throws at render
    ("Event handlers cannot be passed to Client Component props") → a production 500 that
    only surfaces at runtime (build passes). This crashed /board /materials /expenses
    /portal-links. Standing rule: any element with an event handler lives in a `"use client"`
    component. The project switcher is now `components/ProjectPicker.tsx` (navigates via a
    `?project=` query param). Verified: all four routes return 307→login instead of 500.

39. **Web UI is a dark "command console" with a forced-dark design system.** `tailwind`
    `darkMode: "class"` with `.dark` pinned on `<html>` — the app commits to one dark theme
    (a monitoring console is used in low light / on site), so every existing `light dark:*`
    class pair renders its dark variant with no per-component rewrite. Shared design tokens
    and component classes live in `app/globals.css`; the app shell (sidebar + topbar + org
    switcher) is `components/Shell.tsx` and hides itself on `/login` and `/portal/*`. Full
    reference: `docs/WEB_CONSOLE.md`.

40. **Multi-project: engine existed, added the front door + a sticky switcher.** Every
    operational table already carried `project_id` and gated on `has_project_access()`, so
    isolation was already DB-enforced; only a create/manage UI was missing. Added
    `fn_create_project`/`fn_rename_project`/`fn_archive_project` (SECURITY DEFINER, org
    re-derived from the token, admin/PM only — projects keep SELECT-only RLS, no direct
    insert; Rule 1). The active project is sticky via an `sl_project` cookie resolved by
    `lib/activeProject.ts` as **URL ?project= > cookie > first accessible** — and the cookie
    is honoured only if the id is in the caller's RLS-scoped list, so a stale or copied
    cookie can never surface another project's (or org's) data. Recipes / prices / plans stay
    **org-wide on purpose** (a recipe and a price list apply across every project); only
    site-specific data (buildings, stock, expenses, reports, portal links) is per-project.

41. **Edge-function CORS must allow `x-client-info` and `apikey`.** The functions shipped
    with `Access-Control-Allow-Headers: "authorization, content-type"`, but supabase-js
    always sends `x-client-info` (and `apikey`), so the browser preflight failed and every
    call (BOQ upload, Ask) was blocked from the Vercel origin. Fixed to
    `"authorization, x-client-info, apikey, content-type"` on all five functions and
    redeployed. (Redeploy via the MCP tool sets `verify_jwt: true`; that's fine — users
    send a JWT and OPTIONS preflight still passes without auth. The `_shared/ai-router.ts`
    import is flattened to `./ai-router.ts` in the MCP-deployed copy; the repo keeps the
    `../_shared` layout as the source of truth for CLI deploys.)

42. **Price list is editable and deletable — still server-only, still append-only.**
    "Edit" reuses `fn_set_material_price` (same effective_from = same-day correction via
    ON CONFLICT); "delete" is a new admin-only, audited `fn_delete_material_price` for
    removing a wrong dated entry. No client write policy was added — material_prices stays
    server-function-only (Rule 1). AI answers render through a tiny in-house markdown
    component (no external lib; CSP-safe) and are prompted for a direct-answer → figures →
    suggested-action shape so output is readable and actionable.

## 2026-07-30 — BOQ true-cost build (Phases 0–3 + bootstrap)

43. ** Take-off is computed, never materialized.** Assembly expansion to raw
  materials lives in views (`type_material_takeoff`, `work_item_cost` via
  `fn_work_item_unit_cost`) rather than being written into `type_boq_items` —
  avoids a second writer fighting the confirm path and honours Rule 4 (cost is
  always live). Only direct `material_supply` work items also feed
  `type_boq_items`, keeping the existing cost/usage/reorder engines working.
44. ** materials_catalog.id got a DEFAULT.** `fn_upsert_material` failed for
  any NEW material (id NOT NULL, no default; seed's explicit ids hid it — latent
  since M5, live in cloud). Added `DEFAULT gen_random_uuid()` in
  `truecost_core`, same as sibling tables. PRD's client-generated-UUIDv7 rule is
  about idempotency of mutation tables; catalog upserts are keyed on
  (org, lower(name)), so a server default is safe.
45. ** fn_confirm_boq_import (v1) now sums same-(stage,material) rows and the
  recipe unique index is NULLS NOT DISTINCT** — Phase 0 hotfix; v1 semantics
  otherwise unchanged (later import replaces).
46. ** Unpriced-item rate proposals are the live build-up itself** (attach a
  material/assembly → `work_item_cost` prices it); no separate proposal fn in
  Phase 2. Design doc §6's "propose rates" is satisfied by the view + review UI.

47. **Dated `labour_rates` shipped in Phase 3 (not deferred).** Design §3.5 allowed a
    v1 simplification (static rate on the assembly); we shipped the dated ledger the
    same day and `fn_work_item_unit_cost` prefers it over the assembly's static rate —
    labour now re-costs live exactly like materials (Rule 4).
48. **Work-done is per work item, cumulative, with a 150% guard.** Design §6.3 leaned
    per-stage for v1; per-work-item cost the same effort and gives true earned value.
    Entries are cumulative as-of snapshots (latest wins); `fn_log_work_done` rejects
    qty_done > 150% of the designed quantity and is idempotent on idempotency_key.
49. **The bill bootstraps the org (founder-approved).** `fn_bootstrap_stages_from_import`
    fuzzy-maps the bill's elements onto stages the user already designed and only
    APPENDS missing ones — a designed recipe is never restructured.
    `fn_bootstrap_materials_from_import` creates catalog materials from AI guesses and
    seeds prices immediately on that confirm (one explicit human decision, no second
    accept screen) — but ONLY from `material_supply` rows; the §7 guardrail is enforced
    server-side and raises on any attempt to seed from a composite/labour rate.
50. **Extraction progress is server-truthful, not animated.** The wizard creates the
    import row first; the edge function reports each phase into `boq_imports.progress`
    (decoding / enriching n-of-m / validating / staging / error) and the wizard polls —
    so progress survives dropped connections and never lies during a hang.
51. **AI enrichment is parallel, time-boxed, and disposable.** Element chunks run
    concurrently (Promise.allSettled) with per-fetch AbortSignal timeouts (45 s; PDF
    lane 100 s). The first real upload proved ~15 sequential model calls exceed the
    edge wall clock (worker killed, bodyless non-2xx). A failed/timed-out chunk
    degrades to the deterministic rows — enrichment can never kill an import.
52. **Edge deploys use `supabase functions deploy --use-api --project-ref …`.** The CLI
    is logged in but `supabase link` needs the DB password interactively on this box;
    `--project-ref` + API bundling needs neither Docker nor a link.
53. **Per-m² assembly derivation uses standard QS constants (editable, confirm-first).**
    Blockwork: 10 blocks/m² + mortar 0.025 m³/m² (225 mm wall) or 0.020 (150 mm),
    mortar dry factor 1.3, default ratio 1:6. Render/plaster: thickness (default
    15 mm) × area → mortar at 1:4; screed default 40 mm at 1:3. Concrete stays on
    the dry-volume method (1.54, bag = 34.5 L). Every derived figure is shown with
    its working and is editable before `fn_upsert_assembly` — the constants are
    defaults, never facts (Rule 3).
54. **Mangled bill ratios are repaired, visibly.** "1:3.6:20mm aggregate" → strip a
    third term > 8 (aggregate size), snap to the nearest standard mix (1:1.5:3,
    1:2:4, 1:3:6, 1:3, 1:4, 1:6), and show "bill says X — interpreted as Y; edit
    if wrong". Never silently corrected. Bare concrete lines borrow the grade from
    their element/section context, labelled as such, before falling back to
    "custom, no breakdown".
55. **Recipe = timeless document; building = financial event (founder model, 2026-07-31).**
    The recipe page shows exactly two totals — the QS document total (as at import)
    and "cost to start today" (live) — with all setup collapsed behind a finish-setup
    notice. Each building takes an idempotent budget "photograph"
    (`building_budgets` via `fn_snapshot_building_budget`) at start; later price
    moves re-price the recipe but never rewrite a running building's budget. All
    comparison lives per building (`building_money`: budget/spent/earned/forecast)
    plus the focus-and-finish buy list (`building_finish_takeoff` = remaining work →
    mixes → stock units − store). Builder vocabulary app-wide: Mixes, the Bill,
    Shopping list, your price / QS price.
