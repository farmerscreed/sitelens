# M2 plan (DRAFT) — Buildings, phases, batches, the board, stage progress

> Status: **draft for review. Nothing built.** Milestone line already flipped M1→M2.
> Confirm the decisions below before I start building.

## Gate (what "done" means)
PRD §17: **58 buildings stamped from 2 types; the board shows each at its own stage.**
Plus AC-10 architecture: the board must render **300 buildings**, each at its own stage,
filterable by phase/batch/type, without lag (NF-7). We build for 300, demo with 58.

## PRD basis
§2.1 (types/buildings/batches — a building is a copy of a recipe), §8 (the board:
F-BOARD-1..5), §16.2 (tables already exist: `phases`, `batches`, `buildings`,
`building_stage_progress`), §16.4 (`fn_create_buildings`, `fn_advance_batch`,
`fn_complete_stage`).

**All tables already exist from M0.** M2 adds the write functions, the board (web), the
stage-progress flow, and tests. It is the first consumer of M1's recipe library +
versioning (`fn_new_type_version`).

## Core idea
A building is stamped from a **specific type version** and inherits its stages as
`building_stage_progress` rows. Each building carries its own `current_stage_id`, so
"buildings at different stages" is just a per-building label — no special machinery.
Phase/batch are named groupings.

---

## Workstreams & deliverables

### A. Stamp buildings + phases/batches (write path, Rule 1)
- **`fn_create_buildings(type_id, count, project_id, batch_id?, phase_id?, code_prefix)`**
  — manager-gated, audited. Stamps N `buildings` from the type's **current version**
  (records that version on the building so later type edits don't rewrite history —
  F-TYPE-4), seeds one `building_stage_progress` row per `type_stage` (status
  `not_started`), sets `current_stage_id` to the first stage. Idempotent per
  (project, code).
- **`fn_create_phase(project, name, sequence, target_start, target_end)`**,
  **`fn_create_batch(project, phase?, name, sequence, trigger_note)`** — grouping CRUD.
- Buildings/phases/batches tables get **no client write policy**; writes via these fns.

### B. The board (web, command lens) — F-BOARD-1/2
- A board view: every building as a card, arranged in **columns by stage**
  (Not started → Foundation → DPC → Lintel → Roof → Finishes → Done).
- **Filter** by phase/batch/type/stage; **group by batch** to watch a batch move.
- Built to render 300 without lag (server-side aggregation + a compact per-card payload;
  a `board_view` SQL view or `fn_board(project)` returning building + type + stage +
  batch/phase in one query).

### C. Stage progress + completion — F-BOARD-4
- **`fn_complete_stage(building_id, stage_id)`** — marks the stage `done`
  (`completed_at`), advances `current_stage_id` to the next stage (sets it
  `in_progress`), audited. Stage completion is an **approvable event** where the org
  requires it (approver check via role).
- Web UI on the board/card to mark a stage complete (and approve).
- **Note (M5 dependency):** F-BOARD-5 requirement-vs-actual and the "used > required"
  overrun flag need material consumption (material OUT tagged to building+stage), which
  lands in **M5**. In M2, `fn_complete_stage` records progress and can surface the
  **required** materials for completed stages (from the recipe); the actual-vs-required
  **flag** is wired in M5. (See Decision 2.)

### D. Manual batch progression — F-BOARD-3
- **`fn_advance_batch(batch_id)`** — marks the batch `active`, stamps `started_at`, logs
  the **human decision** in `audit_log`. **No auto-trigger** — the system surfaces state
  ("Batch 1 reached DPC") and the **cost/material consequence** of starting the next
  batch, then a human presses "Start Batch".
- **`fn_batch_cost(batch_id)`** (or a view): Σ `fn_type_cost` over the batch's buildings
  — the money consequence shown before starting. Remaining material requirement reuses
  the recipe (full BOQ-aware ordering advice is M6).
- Web "Start Batch N" control with the consequence preview.

### E. Requirement view (recipe side) — F-BOARD-5 (partial)
- Per building: **required** materials for its completed stages (from its stamped
  recipe version), shown on the card. The **consumed** column and overrun flag arrive
  with M5 materials.

### F. Tests + the gate
- **Gate test:** stamp 40 × Type A + 18 × Type B = **58 buildings**; assert each has
  `building_stage_progress` seeded and a `current_stage_id`; the board query returns 58
  grouped by stage.
- Version stamping: edit a type after stamping → existing buildings keep their version.
- `fn_complete_stage` advances the stage correctly; `fn_advance_batch` logs + no
  auto-start; `fn_batch_cost` sums correctly and re-costs when a price changes (ties to
  AC-7).
- Authz (non-manager blocked) + RLS isolation on the new write paths.
- A 300-building stamp sanity/perf check (NF-7 direction, not a full load test).

## Likely file layout
```
supabase/migrations/2026…_m2a_buildings.sql      fn_create_buildings, fn_create_phase, fn_create_batch
supabase/migrations/2026…_m2c_stage_progress.sql fn_complete_stage
supabase/migrations/2026…_m2d_batches.sql        fn_advance_batch, fn_batch_cost, board view/fn
supabase/tests/                                  m2 gate (58 buildings), stage, batch, authz
apps/web/app/board/…                             the board (columns by stage, filters, group)
apps/web/app/buildings/…                         stamp buildings; building card (progress + required)
```

## Verification
`bash scripts/verify_all.sh` extended with the M2 tests; all prior suites (AC-6, A0,
AC-7, B, AC-5, G) stay green. DB layer verified via docker exec as before; board/UI
code-complete (unrun on this box).

---

## Decisions to confirm before building
1. **Stage completion in M2: web-driven (defer mobile to M4)?** F-BOARD-4 says the
   *engineer marks a stage from the field* (mobile), but the Flutter app doesn't exist
   yet (M4). Recommend: in M2 a PM/engineer marks/approves stage completion from the
   **web**, `fn_complete_stage` is the reusable write path; the **mobile** capture wraps
   the same function in M4. The gate ("board shows each at its stage") is met web-side.
2. **Requirement-vs-actual: recipe/required side now, actual + overrun flag in M5?**
   The "actual" needs material consumption (M5). Recommend building the required side +
   leaving a clean seam for M5, rather than pulling materials forward.
3. **Board data path: a SQL view (`board_view`) vs a function (`fn_board(project)`)?**
   Both work; a view composes nicely with RLS and PostgREST filters. Recommend a view +
   thin RPC for aggregates. (Minor — I can just pick the view.)
