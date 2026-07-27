# M1 plan (DRAFT) — Catalogue, price list, recipe library, BOQ import, mapping memory

> Status: **draft for review. Nothing built.** Do not start until the human flips the
> `ACTIVE MILESTONE` line in `CLAUDE.md` from M0 to M1, and confirms the decisions in
> the "Decisions needed" section below.

## Gate (what "done" means)
- **AC-5 (this milestone's core):** a real **Excel** BOQ imports and populates a
  building type; an unfamiliar item is mapped once and remembered. Then the same for a
  **PDF** BOQ (rows as proposals a human confirms).
- **AC-7:** changing one material price re-costs every affected building/batch/plan,
  with old reports unchanged. (Cost is always `quantity × current_price`, computed live.)
- Standing test targets that apply here: **price re-costing** (AC-7), **idempotency /
  no-duplicate-on-retry** on the write functions, **RLS still holds** on every new path.

## PRD basis
§6 (BOQ engine + recipe library), §6.3 (price list), §16.4 (`fn_confirm_boq_import`,
`fn_set_material_price`), §16.5 (`current_price` — already built in M0), §11.3 (OpenRouter
router + `DEV_AI_MODE`), §5.1 (SheetJS server-side; storage behind an adapter).
Features: F-BOQ-1..5, F-TYPE-1..4, F-PRICE-1..4, AI-7 (PDF extraction).

Note: **all target tables already exist from M0** (`materials_catalog`, `material_prices`,
`building_types`, `type_stages`, `type_boq_items`, `type_stage_costs`, `type_folders`,
`boq_imports`, `boq_import_rows`, `material_aliases`). M1 adds **write functions, the
import pipeline, the cost computation, and the UI/entry points** — not new core tables.

---

## Workstreams & deliverables

### A. Price list + first money-path write function (Rule 1)
- **`fn_set_material_price(org, material, unit_price, effective_from)`** — SECURITY
  DEFINER; inserts a **new dated row**, never overwrites; writes an `audit_log` entry;
  enforces caller is Admin of the org. (F-PRICE-1/2)
- Confirm `current_price()` (M0) + a **cost view/function** that computes
  `Σ type_boq_items.quantity × current_price(...) + Σ type_stage_costs.amount` per type
  (and per building later). Live, never frozen. (F-PRICE-3/4, §16.5)
- **Test:** insert price v1, cost a type; insert price v2; assert the type re-costs and a
  historical query at v1's date still returns v1 (AC-7).

### B. Recipe library (building types)
- Server write functions (SECURITY DEFINER, Admin-gated, audited) for:
  create/edit a type, add/reorder `type_stages`, add `type_boq_items` (**quantity only,
  no price**), add `type_stage_costs`. (F-TYPE-1)
- **Duplicate-and-tweak** (F-TYPE-3) and **versioning** (F-TYPE-4): editing a type that
  already has buildings creates a new `version` via `parent_version_id`; existing
  buildings keep their stamped version. (Buildings arrive in M2 — M1 builds the version
  mechanics and leaves the stamping hook.)
- Foldered library CRUD (`type_folders`) (F-TYPE-2).

### C. Storage adapter + raw-file retention (F-BOQ-5)
- One storage interface `put / getSignedUrl / delete` (PRD §5.1). **Local = Supabase
  Storage**; production swaps to R2 with no app changes. Config-driven (`STORAGE_PROVIDER`).
- A private bucket for BOQ source files; 15-min signed URLs; opaque UUID object keys.
- Store the original `.xlsx/.pdf` and link it via `boq_imports.source_media_id` → `media`.
- Append the R2-bucket-creation note to `CLOUD_MIGRATION.md` (already flagged there).

### D. Excel import lane (F-BOQ-1) — no AI
- Upload `.xlsx/.csv` → parse server-side with **SheetJS**.
- **Column-mapping screen**: user points out item/quantity/unit/rate columns; the mapping
  is **remembered per org** so the next same-format upload maps automatically.
- Parsed rows land in `boq_import_rows` (status `proposed`).

### E. PDF import lane (F-BOQ-2 / AI-7)
- Upload PDF → **vision model via the OpenRouter router** extracts rows into the same
  `boq_import_rows` structure, each with `confidence`. **Every row is a proposal a human
  confirms — never auto-committed** (Rule 3).
- Behind the router abstraction with **`DEV_AI_MODE`** returning a canned extraction so it
  builds/tests with no paid key. Real key only when present.

### F. Item-mapping memory + BOQ commit (F-BOQ-3/4, Rule 1 & 3)
- First time an unfamiliar item text appears, user maps it to a catalogue material once →
  store in `material_aliases`; auto-recognise thereafter.
- **`fn_confirm_boq_import(import_id, confirmed_rows[])`** — SECURITY DEFINER, one atomic
  commit: writes confirmed rows into `type_boq_items`, stores any new aliases, marks the
  import `confirmed`, audited. This is the only write path into the recipe (no client
  write policy on `type_boq_items`).
- **Idempotency:** the confirm function is safe to retry (guard so a re-submit doesn't
  double-insert recipe rows).

### G. Tests (the dangerous parts — non-negotiable)
- Price re-costing (AC-7) + historical price stability.
- BOQ proposal → human confirm → `type_boq_items` populated; unfamiliar item mapped once
  then auto-mapped on a second import (AC-5).
- Idempotent confirm (retry = no duplicate rows).
- RLS/authz: a non-admin cannot call the write functions; org A cannot import into org B.
- All runnable via the same `docker exec` harness M0 uses (this box can't `db reset`).

---

## Decisions — LOCKED (2026-07-27)
1. **Full Next.js + Tailwind web app** built this milestone (command console).
2. **Supabase Edge Functions** (Deno) run BOQ parse + PDF extraction.
3. **Both lanes** (Excel and PDF) in M1.
4. **`type_boq_items` unchanged** — provenance stays on `boq_import_rows`; no schema
   change to the recipe table (DECISIONS #14 to be logged when built).

## New dependency this choice surfaces — auth / the `active_org_id` claim
The full web app means **real Supabase Auth logins** now (not M0's hand-minted JWTs).
RLS gates on `request.jwt.claims.active_org_id`, so we must wire the token to carry it:
- A **custom access-token hook** (Supabase auth hook, Postgres function) that injects
  `active_org_id` + `role` into the JWT, and an **org-switch** endpoint that reissues the
  token. (CLOUD_MIGRATION.md already flags this for cloud.)
- **Dev auth shim:** phone-OTP auto-confirm / fixed test OTP — never a real SMS locally.
This is a real M1 workstream (call it **A0**), because without it the web app can't
enforce the isolation M0 proved.

## Concrete file layout
```
apps/web/                                   Next.js + Tailwind command console
  app/(auth)/…                              login (phone OTP dev shim), org switch
  app/catalogue/…                           materials CRUD
  app/prices/…                              dated price editor (calls fn_set_material_price)
  app/recipes/…                             building-type editor: stages, boq items, stage costs,
                                            duplicate, versions, folders + live cost readout
  app/boq-import/…                          upload → column-mapping (Excel) / row-confirm (PDF) → commit
  lib/supabaseClient.ts                     browser + server Supabase clients
  lib/storage/                              storage adapter: put / getSignedUrl / delete (Supabase Storage; R2 later)
  lib/ai/router.ts                          OpenRouter router + DEV_AI_MODE stub
supabase/functions/
  boq-parse/                                Excel parse (SheetJS) → boq_import_rows
  boq-extract-pdf/                          PDF vision extract via lib/ai router → boq_import_rows (proposals)
  storage-signed-url/                       15-min signed URL after a permission check
supabase/migrations/
  2026…_m1_auth_token_hook.sql              access-token hook injecting active_org_id + role
  2026…_m1_price_fn.sql                     fn_set_material_price + live cost fn/view
  2026…_m1_recipe_fns.sql                   type/stage/boq/stagecost write fns + versioning
  2026…_m1_boq_confirm_fn.sql               fn_confirm_boq_import (+ alias upsert), idempotent
  2026…_m1_storage_buckets.sql              private BOQ-source bucket + storage RLS
supabase/tests/ + tests/                    AC-5, AC-7, idempotency, authz, alias-memory tests
```

## Build order (small, reviewable commits — one logical change each)
- **A0** auth token hook + dev OTP shim + web login/org-switch (unblocks real RLS in the app)
- **A** price write fn + live cost fn + AC-7 test
- **B** recipe write fns + versioning + recipe editor UI
- **C** storage adapter + signed-url fn + buckets
- **D** Excel lane: `boq-parse` fn + mapping UI + per-org mapping memory
- **E** PDF lane: `boq-extract-pdf` fn (DEV_AI_MODE) + row-confirm UI
- **F** `fn_confirm_boq_import` + alias memory + AC-5 test (Excel then PDF)
- **G** hardening: idempotency, authz, RLS-on-new-paths tests
Each lands with its test green before the next. New deps introduced: `next`, `react`,
`tailwindcss`, `@supabase/supabase-js`, `xlsx` (SheetJS) — all within the PRD stack.

## Verification → gate mapping
| Deliverable | Proves |
|---|---|
| D + F | AC-5 (Excel) |
| E + F | AC-5 (PDF, proposals) |
| A | AC-7 |
| A,B,F write fns with no client write policy | Rule 1 upheld end-to-end |
| G idempotency test | no-duplicate-on-retry |

---

## Open items still worth a quick check before/at build time
- **PDF vision model choice** stays config (OpenRouter); default a strong vision model,
  benchmark a cheap one on real Nigerian BOQs later (PRD §11.3) — no code impact now.
- **Column-mapping storage:** remember per-org Excel mappings — small table or a JSONB on
  a per-org settings row? Decide at workstream D (leaning: a small `boq_column_mappings`
  table keyed by org + detected header signature).
- Confirm the **dev OTP** mechanism with Supabase local (auto-confirm vs fixed test code).

_All four scope decisions are locked above; this section is only minor detail to settle
inside the relevant workstream, not a blocker to starting._
