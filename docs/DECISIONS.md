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
56. **Contract scope: a semi-finished bill is 100% at its contract (founder,
    2026-07-31).** Every work item is in-contract or excluded (by others);
    the bill sets the default (priced = in, unpriced = out; insert trigger for
    future imports). All recipe totals/coverage/setup and building budget photos,
    EV, and finish buy lists compute over contract lines only; the excluded
    bucket stays visible with its "to finish fully" value. Pulling an excluded
    line into ONE building is a dated, audited VARIATION (building_variations,
    est captured at addition, extends only that building's budget) — never a
    silent flag flip. Standing design rule recorded the same day: EASE OF USE
    FIRST in every design (data-derived defaults, one-tap bulk actions, builder
    words, visible feedback, done-things disappear, explain why inline).
57. **Archive (soft-delete), not hard-delete, for buildings and recipes (pilot,
    2026-07-31).** The pilot stamped 6+ buildings from an EMPTY recipe (Terrace
    Type A) with no way to remove them, re-point them, or delete the recipe.
    Chosen: reversible archive (`archived_at`/`archived_by`), consistent with the
    append-only philosophy and the existing projects-archive precedent — never a
    hard delete on money-adjacent rows. `fn_archive_building` /
    `fn_unarchive_building` / `fn_archive_building_type` / `fn_unarchive_building_type`
    (SECURITY DEFINER, manager-gated, audited; tables keep NO client write policy —
    Rule 1). A building's `(project, code)` uniqueness became a PARTIAL unique index
    (`WHERE archived_at IS NULL`) so an archived code frees up for re-stamping the
    same code onto the right recipe. Archiving a recipe is BLOCKED while any LIVE
    building uses it (archive/move them first) — no building is ever left pointing at
    a hidden recipe. `board_view` and the recipe library already filter archived out.
    "Change a building's type" = archive + re-stamp from the correct type (the stamp
    flow already exists); there is no in-place type swap because stage-progress rows
    are wired to the type's stages. No hard-delete path was added.
58. **Earned value blends the QS-rate fallback, same basis as the budget (pilot,
    2026-07-31).** `building_work_ev.planned_value`/`earned_value` valued work from
    `fn_work_item_unit_cost` ALONE (own build-up), while the budget photo
    (`fn_snapshot_building_budget`) and the money card's "remaining" already used the
    BLENDED `COALESCE(own build-up, boq_rate)` — the same est_cost the recipe headline
    uses. A real Type-B building therefore showed a ₦288.8M budget but a ₦140.7M
    planned value (the ₦148M across 53 QS-rate lines was silently dropped, and % progress
    measured against < the whole job). Fix: blend planned/earned/unit_cost the same way
    and expose `est_source` (build_up | boq_rate) so the fallback is labelled, never
    silent (Rule 4). building_money unaffected (its "remaining" already COALESCE'd;
    "earned" now correctly counts QS-rate lines with logged work). The building page
    tags QS-rate lines "QS rate". A view-only change; CREATE OR REPLACE + appended
    est_source column keeps building_money valid.
59. **Material planning unified on the take-off; store/variance/procurement split by
    grain (pilot, 2026-08-01).** `type_boq_items` holds only DIRECTLY-supplied
    materials; `type_material_takeoff` is the COMPLETE picture (direct + materials
    derived from mixes/assemblies, with waste + unit conversion). So "planned material"
    = `type_material_plan` (a view: take-off, with a `type_boq_items` FALLBACK per
    (type,stage,material) the take-off doesn't cover — so manually-built recipes and the
    existing type_boq_items-based tests keep working). Repointed onto it:
    `building_req_vs_actual` (+`planned_total`/`remaining`), `fn_reorder_advice`, and the
    AC-9 overrun in `fn_complete_stage` — the overrun check now catches mix-derived
    materials too. New `batch_material_plan` (per-batch procurement). Split by the RIGHT
    grain: **store = project pool** (Materials page: on-hand + a project procurement
    plan + optional by-batch); **variance = per building** (building page "Usage vs
    plan": planned/used/remaining + overrun vs the plan for COMPLETED stages) — a project
    average was hiding per-house overrun, so the old project-wide "usage vs plan" table
    on the Materials page was retired; **procurement = project/batch**. reorder + all
    plans now also ignore archived buildings (ties DECISIONS #57).
60. **Planner on the true-cost engine (pilot, 2026-08-02).** `fn_compute_feasibility`
    and `fn_max_delivery` costed each stage as Σ(type_boq_items.qty × current_price) +
    type_stage_costs — direct-supply materials + non-material stage costs only. For a
    work-item/mix recipe (Terrace Type B) that is a ~5× undercount (₦60.5M vs the true
    ₦288.8M): labour, plant, mix-derived materials and QS-rate lines are all missing, so
    every plan figure (total, per-period, peaks, funding gap, max-delivery) was far too
    low — the planner was unusable for real cash planning. Fix: a unified `type_stage_cost`
    view = work-item `est_cost` per stage (in-scope; mixes + labour + QS-rate fallback,
    same basis as DECISIONS #58/#59) where a type has work items, else the legacy
    type_boq_items + stage-cost basis (so manually-built recipes and the AC-8 test — which
    have no work items — stay byte-for-byte unchanged); unstaged work-item cost folds into
    the type's first stage so nothing is dropped. Both planner functions read the view.
    Verified: Type B feasibility now = the recipe cost.
61. **Standardized client milestones (pilot, 2026-08-02; research-backed).** The 15 QS
    stages are too granular for clients; roll them into ~6 recognizable milestones
    (Foundation, Structure, Roofing, Walls & openings, Services/MEP, Finishes) + Handover
    — matches BuildWatch (a Nigerian construction proptech) and global practice. `milestone`
    lives on `type_stages` (auto-mapped from the stage name by `fn__default_milestone` via a
    BEFORE-INSERT trigger + backfill; editable via `fn_set_type_stage_milestone`, manager-
    gated). `building_milestones` derives done/in_progress/not_started per building from stage
    completion — no new source of truth. Overall client % stays COST-WEIGHTED (earned value,
    not stage count) per research ("activities are not equal"). Milestone order = the earliest
    stage sequence in each (so "Services" trails "Finishes" when the bill orders M&E last).
62. **Sales & milestone/time-linked payments (pilot, 2026-08-02; money path).** Two plan
    models, research-grounded: a BUYER buys a building on a MILESTONE-linked plan (default
    20/15/15/15/15/20; a tranche is due when its milestone is reached), a PARTNER / master
    developer invests project-wide on a TIME-PHASED plan (default 30% + 4x17.5% at months
    0/6/12/18/24; due when the month arrives). Tables `sales` / `payment_tranches` / `payments`
    (append-only, idempotent on idempotency_key, voidable, ON DELETE RESTRICT, NO client write
    policy - Rule 1); `fn_create_sale` seeds the default tranches, `fn_record_payment` /
    `fn_void_payment` are the only write paths. Payments fill tranches in ORDER (waterfall);
    `payment_schedule` derives paid/part/unpaid + is_due; `sale_payment_summary` gives
    paid/outstanding.
63. **Client portal v2 - two audiences + email (pilot, 2026-08-03).** A portal link carries
    an audience: a BUYER link is scoped to one building (progress %, milestone stepper,
    milestone-linked payment schedule with due flags, photo count - NO project money), a
    PARTNER link is project-wide (progress, homes-by-milestone, budget/spent, sales/collected,
    photos). `fn_portal_view` branches on `link_type` and STILL hand-selects safe columns only
    - no supplier names, unit prices, or worker data reach either view (F-13.6). Links deliver
    by email (Resend) or phone via the notifications abstraction. Research: photos are the #1
    trust driver and the field app's GPS-verified in-app-only capture already matches best
    practice (BuildWatch); the in-web photo GALLERY is the remaining piece, deferred until the
    mobile app feeds real photos (the portal already surfaces the count). What clients are owed
    = progress + proof, not a spend breakdown (that stays an internal/optional view).
64. **Client hub = a thin directory, not a CRM (pilot, 2026-08-03).** One place to answer
    "pull up this client - who, which houses, what's paid, what's due, portal access."
    A first-class `clients` table (org-scoped, RLS SELECT-only, writes via SECURITY DEFINER
    fns - Rule 1) with four revisions on the original spec (docs/CLIENT_HUB.md):
    (a) THE CLIENT IS THE FRONT DOOR OF A SALE - the sale form type-ahead matches existing
    clients or get-or-creates one in the same submit (`fn_create_client` dedups on
    (org, lower(email)) with a partial unique index; same email = same person);
    `sales.party_name` remains as denormalised display for legacy rows; a one-tap
    "add to directory" panel absorbs pre-hub sales and then disappears. (b) `kind`
    (buyer/partner/both) is DERIVED from their sales in `client_summary`, never stored -
    it can't drift. (c) ARCHIVE IS BLOCKED WHILE MONEY IS OWED (`fn_archive_client` raises
    if outstanding > 0): you cannot hide someone with a balance; clean clients soft-delete
    like buildings/recipes. (d) COLLECTIONS SURFACE WHERE THE FOUNDER LOOKS: `client_summary`
    computes due_now (triggered-but-unpaid tranche remainder via `payment_schedule`) +
    next_due_label; the dashboard gets a Collections card (top overdue clients, disappears
    when nothing is due) and the directory sorts by due_now. `fn_create_sale` /
    `fn_create_portal_link` were DROPped and recreated with an optional `p_client` (dropping
    first avoids PostgREST rpc ambiguity - same move as portal_v2); `fn_link_sale_client`
    back-links old sales; portal links prefill + file under the client. Explicitly NOT
    built (kept construction-management, not Salesforce): lead pipeline, marketing, tasks,
    document vaults, message threads, calendars.
65. **Field ops: engineer stage ticks land instantly, labelled (mobile Phase A,
    2026-08-03).** The PRD (§4) always gave the Site Engineer "mark building stages
    complete" + "log materials in/out", but fn_complete_stage had been manager-gated
    since M2 (web console was the only surface). Founder decision for the field app:
    INSTANT + LABELLED beats propose-and-wait — the board/milestones/portals move the
    moment the engineer ticks, the tick is visibly provenance-stamped, and a manager
    can revert. Implementation: building_stage_progress gains completed_by +
    completed_source ('web'|'field') per Rule 2; fn_complete_stage(p_source DEFAULT
    'web') now admits the engineer role (client role + cross-org still 42501) and sets
    approved_by ONLY for admin/pm — a field tick leaves approved_by NULL so it is never
    silently equal to a manager tick; fn_reopen_stage (manager-only) reverts and rewinds
    buildings.current_stage_id. Old 2-arg signature dropped (PostgREST ambiguity).
    Materials needed NO change — fn_log_material_txn was already member-gated with the
    AC-4 balance guard. Web: "from field" badge + an undo affordance on done stages.
    The m2 test's "engineer cannot complete" assertion was deliberately FLIPPED (the
    contract changed); field_ops.sql owns the full field contract. Devices decision:
    the app targets ANDROID 8+ only (PRD spec + Nigerian field reality + APK sideload);
    iOS stays open via Flutter but is deferred until someone real needs it.
66. **Member administration — invite / list / deactivate (2026-08-03; deferred scope pulled
    forward with founder sign-off).** "Account administration" is on the `[LATER]` list
    (CLAUDE.md) and we are mid-M8, but a friend testing the app hit `signInWithOtp`'s
    "Signups not allowed for otp" — by design: login uses `shouldCreateUser:false`, so only
    provisioned users get in and there is NO self-signup. Rather than hand-provision, the
    founder chose to build the real invite feature. An org **admin** invites by email + role
    (`admin`/`pm`/`engineer`/`client`); the invitee then signs in normally with that email —
    the login page is UNCHANGED, the invite just puts people on the right side of the existing
    wall. Account creation needs the GoTrue admin API (SQL can't mint a user), so it lives in
    the **`invite-member` Edge Function** (service role); but AUTHORIZATION stays in the DB —
    `fn_add_member` / `fn_set_member_active` are SECURITY DEFINER, require the caller be an
    active admin of their **current** org (`fn_require_org_admin`), and derive the org from
    the caller's JWT — there is **no org parameter**, so an admin of Org A cannot grant into
    Org B (cross-org injection is structurally impossible, and tested). The function authorises
    up-front (so a rejected non-admin never orphans a GoTrue user) and re-checks in the DB.
    `app_users.phone` made **nullable** (email-invited members have no phone; still UNIQUE —
    Postgres treats NULLs as distinct). Re-invite is idempotent (upsert role + reactivate, no
    duplicate — `UNIQUE(org_id,user_id)`). Deactivate is soft (`is_active=false`; memberships
    are never hard-deleted — financial FKs are `ON DELETE RESTRICT`) with two lock-out guards:
    you cannot deactivate yourself or the last active admin. Roster read (`fn_org_members`) is
    open to any active member; management is admin-only, and the `/team` nav item + page are
    admin-gated. Tests: `supabase/tests/member_invite.sql`.
67. **Field app v1 scope is CLOSED; redesign + persistent signing (2026-08-03).**
    Founder decision: the app stays at exactly three jobs (report+photos, mark done,
    materials in/out) — no money, no planner, no Ask on the phone; new screens must
    be earned by pilot evidence (attendance when F-12 lands; a PM approvals mode if
    the PM proves phone-first). Visual redesign to the "command console in your
    pocket" language (glow orbs, glass panels, amber-sheen CTAs, glowing icon orbs,
    step bar; legibility first). CI now re-signs the APK with a persistent PKCS12
    keystore (repo secrets ANDROID_KEYSTORE_B64/PASS; key file safeguarded outside
    the repo at ~/.sitelens/ on the dev box — if lost, one forced reinstall) and
    stamps versionCode from the run number, so updates install OVER the old build
    and never wipe the offline queue. Signed cert: CN=SiteLens, O=Vantara
    International. Verified end-to-end on the founder's phone.
68. **Workbook-aware BOQ ingest — three lanes, one front door (2026-08-04).**
    Driven by the founder's two real Vantara workbooks (QS original + AI-rescoped
    working BOQ), which the single-sheet wizard could not ingest. Judgment calls
    where the PRD/design doc were silent: (a) **duplicate-sheet rule** — a bill
    sheet whose item fingerprints are ≥60% contained in a same-or-larger sheet is
    the subset and defaults excluded (the QS file's cumulative sheet 01 repeats
    sheets 02–06; importing both would double-count ~₦367m); the human can
    re-include on the workbook map. (b) **One import per bill sheet**, not one
    workbook-wide import — review/confirm/bootstrap machinery unchanged, and the
    sheet name becomes the element fallback so stages bootstrap per bill.
    (c) **Rates-sheet prices may enter material_prices** — deliberately distinct
    from §7: section-A "input prices" are genuine delivered market prices (the
    workbook derives its bill rates FROM them), unlike all-in bill rates which
    stay banned; labour and build-up rows are filed as reference inferences only.
    (d) **Split-rate capture** — parsed_rate_material/labour on staging,
    boq_rate_material/labour on work items; boq_rate remains the all-in reference
    (Rule 4 untouched); the §7 price proposal now prefers the material component;
    AssemblyProposals takes labour stated by the bill over the derived residual.
    (e) **Check values are graded, never imported** — schedule/summary sheets land
    in boq_check_values (replace-by-sheet idempotent) and type_takeoff_check
    compares them live against the computed take-off; incomparable rows surface as
    NULL variance, never a guess. (f) **Element promotion heuristic** — a works
    title directly above its own column header names the element zone (how both
    real workbooks are structured); verified against the NPC-class grammar tests.
69. **Recipe covers + guided import flow (founder feedback, 2026-08-04).**
    (a) Building types get a COVER photo (render/elevation) shown on the recipe
    library cards and recipe header — one display-size image in a new private
    `type-covers` bucket (org-prefix keys, 15-min signed URLs, fn_set_type_cover
    with an org-prefix guard). Judgment call: this is a design asset, not site
    media, so the three-derivative pipeline (PRD §5.3) deliberately does NOT
    apply. (b) The founder found the multi-bill import disorienting, so the flow
    now steers: a live "route through this workbook" stepper on the wizard
    (extract → seed prices FIRST → review bills in order → capture cross-checks
    → recipe), a "Start reviewing" button on the first staged bill, the review
    finish screen hands the user the NEXT unconfirmed bill (with a remaining
    count), and /boq-import shows a "continue where you left off" list of staged
    imports so leaving the page never loses the thread. (c) Founder asked whether
    a downloadable template for external-AI pre-formatting is needed — decided
    NO (advised, accepted): native ingest + reconciliation against the bill's own
    totals is the trust mechanism, and a reformatted intermediate can't be checked
    against itself; revisit only if a document class defeats the extractor.
70. **Prices before bills — import flow reordered (founder feedback, 2026-08-04).**
    Second first-use correction, and the founder was right: the wizard's route
    ordered "extract bills → seed prices → review" to overlap extraction time
    with price entry — a wall-clock optimization that traded away clarity. The
    honest constraint is only that prices exist BEFORE review/confirm (that is
    when supply lines price, implied labour computes, and dropdowns populate);
    extraction never touches prices. But prices-first is the better human order:
    quick, impossible to get wrong, and the rates sheet's materials are already
    in the catalog when bills arrive for review. The rates panel now sits ABOVE
    the extract step and the stepper leads with it.
71. **Delete & edit paths — with an immovable line (founder request, 2026-08-05).**
    The founder asked for delete/edit of "everything": extracted bills, recipes,
    buildings. Built as guarded SECURITY DEFINER fns (Rule 1), with ONE refusal
    held and stated to the founder: financial records (expenses, material
    movements, payments, sales) remain append-only — void, never delete or edit;
    even a VOIDED movement still blocks its building's deletion (history is
    history). What deletes: boq imports (staging is proposals; a CONFIRMED
    import cascades its work items only with explicit consent and the classic
    recipe is recomputed per touched (stage,material) group); single work items
    (same recompute); buildings with NO history (admin-gated; any money/reports/
    photos/work-done/sales/portal links → refused with the list, pointing at
    archive); recipes with nothing stamped from them (admin-gated; buildings or
    planner lines → refused; child versions unlinked, imports cascade). Edit:
    fn_update_work_item gains a movable stage; moving/deleting a supply line
    UPSERTS its summed projection into both touched recipe groups (found in
    testing: update-only silently dropped a line moved to a fresh stage).
    UI: two-click danger buttons (no native dialogs) on the import list, review
    page, recipe danger zone and building header; per-line stage picker + delete
    on the recipe's Bill table. Suite: delete_paths.sql.
