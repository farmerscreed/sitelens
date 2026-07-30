# BOQ → TRUE-COST MODEL — design v2 (authoritative; supersedes v1 and BOQ_INTELLIGENCE "Proposed design")

**Status: IMPLEMENTED (2026-07-30) — Phases 0–3 built, verified (35 migrations,
24 suites incl. the real NPC gate at 0% variance) and deployed to cloud, plus a
founder-requested addition beyond this doc: setup-from-bill bootstrap (stages from
elements, materials + seeded supply prices) and a server-truthful extraction progress
stepper — see DECISIONS.md #43–52 and STATUS.md.** The design below is kept as
written/approved; deviations are logged in DECISIONS (notably: dated labour rates
shipped in Phase 3 rather than deferred, work-done is per work item not per stage,
take-off is computed in views, never materialized). v2 was a full redesign
after a line-by-line QS review of the founder's real bill
(`docs/BOQ FOR NPC XORA BAY 2 BEDROOM STRETCH TERRACE 150526.xlsx`, ₦280m, 15 elements,
1,601 rows) against the shipped pipeline. The review found the current Excel lane cannot
parse this document class, the AI lane's schema loses the information needed to validate
an import, and two live correctness bugs in `fn_confirm_boq_import`. Section 12 is the
implementation plan; Phase 0 (bug hotfix) should ship immediately on approval.

---

## 0. What changed from v1

- **New: document grammar** (§2) — the extraction target is a *document with internal
  structure*, not a table. Both lanes (spreadsheet and PDF/photo) now go through the same
  AI brain; the browser still parses the grid, but the grid goes to the model as text.
- **New: reconciliation against the bill's own arithmetic** (§5) — the import's headline
  trust signal.
- **New: priced vs unpriced scope as a first-class concept** (§6) — the sample's quoted
  total does NOT price the whole building (4 elements carried at ₦0, many "NOT
  APPLICABLE" rates). SiteLens must expose this, then close it from its own price book.
- **Extended: assemblies** now carry waste factors, reusable components (formwork), and
  alternative production routes (bought vs site-molded blocks) (§3.3).
- **New: material conversions table** (t↔m³ densities, rebar tons↔12m pieces) (§3.4).
- **New: Phase 0 hotfix** for two live confirm bugs (§9).
- **Tightened: price proposals** may only come from `material_supply` rows — BOQ rates
  are all-in composite rates and would corrupt the market price list (§7).
- Open questions from v1 §6 are now **decided defaults** the founder can veto (§11).

Unchanged from v1: the hybrid three-layer model (work items → assemblies/mixes → raw
materials), labour tracked like materials, `boq_rate` as reference only, all four Golden
Rules, design-doc-first.

---

## 1. The goal

Import a real QS Bill of Quantities and use it to know and monitor the **true cost of a
building — materials AND labour — from start to finish**, with the BOQ as the project's
center of truth. Success = the building completes close to a *known, honest* figure. That
requires two things the current system doesn't do:

1. **Decode the document faithfully** — every measured item lands in the right stage with
   the right quantity, unit, and rate, and nothing that isn't an item (notes, collections,
   summaries, page furniture) pollutes the data.
2. **Tell the truth about the figure** — reconcile the extraction against the bill's own
   totals, and separate *priced scope* from *measured-but-unpriced scope* so the "budget"
   is never silently short of the real cost to finish.

Three linked layers (unchanged):

1. **Work items** — the BOQ's measured lines, grouped by element/stage, carrying the QS
   rate for reference and driving work-done tracking.
2. **Assemblies / mixes** — ratio rules that turn a work quantity into raw materials +
   labour (Grade 20 = 1:2:4 → cement/sand/granite per m³).
3. **Raw materials** — the stock and price list already tracked.

## 2. The document grammar (what the sample taught us)

Real Nigerian elemental bills (SMM/POMI style) are **documents, not tables**. Verified
against the sample:

| Feature | Sample evidence | Consequence for extraction |
|---|---|---|
| Front matter | Title page, GENERAL SUMMARY with VAT/WHT arithmetic | Classify & skip as items; capture totals as **check values** |
| Repeating column headers | `S/N DESCRIPTION QTY UNIT RATE AMOUNT` ~12×, casing varies | Never treat row 1 as "the header" |
| Element → work-section → item hierarchy | ELEMENT 1 SUBSTRUCTURE → E10 CONCRETE → items | Preserve as `section_path`; element ≈ stage suggestion |
| Preamble notes that look like items | Notes A–C; one has "Item" in the UNIT column | Classify as `note`, never stage as item |
| Parent spec + measured children | Rebar "M" carries the spec; N/P/R carry tonnages | Child items inherit parent description context |
| Dittos | "Ditto Pad Base" 287 m³ (₦1m), ditto windows | Resolve against preceding full description; keep both raw and resolved text |
| Narrative quantities | Frame preamble "16 m³ total" vs items 17+35=52 m³ | Quantities come ONLY from measured item rows |
| Cast lines | "To Collection", "Page 1/2", "…TO SUMMARY" | Capture as `collection`/`summary` check rows |
| Unit chaos | m2/Sq.m/Sq,m/Sq.m., Cu.m/m3, Tons/Ttons, Nr/Nrs/Nos, Lm/l.m, ltem | Deterministic normalization dictionary (§8) |
| Text quantities | qty cells "2", "1.57" as strings | Coerce with flag |
| Unpriced scope | Elements 9/11/12/13 at ₦0; "NOT APPLICABLE" rates | `is_priced=false`, first-class (§6) |
| Provisional | "ALL PROVISIONAL", `sum` items, blank qtys | `is_provisional=true`, import as placeholders |
| Mangled mix ratios | "conc mix 1:3.6:20mm aggregate" (= 1:3:6, 20mm agg) | Sanity-net AI-read ratios against a known grade↔ratio table |
| Rate anomalies | Grade 20 = Grade 25 = ₦195k/m³; ÷17 scaling artifacts | Flag, don't block — reviewer's call |
| Possible double counts | Clearing (incl. topsoil) + separate topsoil item, both 728 m² @300 | Flag similar-scope pairs for review |
| Self-checking arithmetic | Every element cross-casts exactly to ₦289,075,717.35 | **Reconcile — the bill grades our extraction** (§5) |

## 3. Data model (new + extended tables)

Conventions (all SiteLens rules apply): UUIDv7 PK, `idempotency_key` on mutation tables,
RLS on every table with no client write policies, writes only via `SECURITY DEFINER`
functions (Rule 1), money `NUMERIC`, observed values carry
`source/confidence/model_id/verified_by` (Rule 2).

### 3.1 Extraction staging — extend `boq_imports` + `boq_import_rows`

`boq_import_rows` gains:

```
row_kind        enum('item','note','element_header','section_header','column_header',
                     'collection','summary','title','footer')   -- only 'item' is confirmable
boq_ref         text          -- S/N as written ("A","L1","M"); nullable
section_path    text[]        -- e.g. {'ELEMENT 1 SUBSTRUCTURE','E10 CONCRETE'}
resolved_text   text          -- ditto-resolved description (raw_text stays verbatim)
amount          numeric       -- the bill's AMOUNT cell (check value)
is_provisional  boolean default false
is_priced       boolean default true      -- false when rate blank / "NOT APPLICABLE"
suggested_stage_id    uuid → type_stages  -- AI suggestion, human confirms
suggested_kind  enum (work-item kind, §3.2)
mix_ratio       text          -- AI-read ratio for composites ("1:3:6"), nullable
flags           jsonb         -- machine validation flags (§5), e.g.
                              -- ["amount_mismatch","unknown_unit","ditto_unresolved",
                              --  "qty_text_coerced","possible_duplicate","narrative_qty_ignored"]
field_confidence jsonb        -- per-field: {"qty":0.98,"unit":0.7,"stage":0.6,...}
```

`boq_imports` gains:

```
document_totals jsonb   -- totals the document states: per element, grand, VAT/WHT lines
reconciliation  jsonb   -- computed: extracted vs stated, variance, unexplained rows (§5)
priced_total    numeric -- Σ item qty×rate where is_priced
unpriced_count  int     -- measured items with no rate
```

### 3.2 Work items — `type_work_items`

The BOQ's measured lines, attached to a recipe (`building_types`) and a stage.

```
id, building_type_id → building_types, stage_id → type_stages (nullable = unassigned),
element_name    text      -- BOQ grouping verbatim ("ELEMENT 1 SUBSTRUCTURE")
section_name    text      -- work section ("E10 CONCRETE"); nullable
boq_ref         text      -- S/N as written
description     text      -- ditto-resolved QS text (raw kept on the staging row)
quantity        numeric
unit            text      -- normalized (§8)
kind            enum('material_supply','composite','labour','plant','provisional','fitting','other')
assembly_id     → assemblies        (nullable; set for composite)
material_id     → materials_catalog (nullable; set for direct material_supply)
boq_rate        numeric   -- QS all-in rate; REFERENCE ONLY, never the live cost driver
is_priced       boolean   -- false = measured but unpriced in the bill (§6)
is_provisional  boolean
source, confidence, model_id, verified_by, created_at
```

> **Rule 4 kept:** live cost is recomputed from materials × current price + labour ×
> current rate. `boq_rate` seeds proposals and shows variance; it is never frozen cost.
> **Bug-1 note:** each BOQ line is its own work item — the "two lines, one material,
> quantity overwritten" failure mode disappears at this layer by construction.

### 3.3 Assemblies — `assemblies` + `assembly_components`

Reusable, org-level. A composite work item points at an assembly.

```
assemblies:
  id, org_id, name ("Concrete grade 20 (1:2:4)"), unit (m3|m2|nr),
  kind (concrete|blockwork|mortar|render|screed|custom),
  ratio text ("1:2:4"), dry_factor numeric default 1.54,
  labour_rate numeric,   -- ₦ per output unit, v1 (dated ledger in Phase 3)
  plant_rate numeric,
  alternative_group text,  -- assemblies producing the same output (e.g. '225mm blockwork':
                           -- 'bought blocks' vs 'site-molded blocks'); pick per work item
  source, confidence, model_id, verified_by

assembly_components:
  id, assembly_id, material_id → materials_catalog,
  qty_per_unit numeric, unit text,
  waste_factor numeric default 1.05,   -- breakage/off-cuts/over-break; editable per component
  component_kind enum('consumable','reusable') default 'consumable',
  reuse_count numeric,                 -- reusable only (formwork boards ~6 uses):
                                       -- effective qty = qty_per_unit × qty / reuse_count
```

- **Ratio → components:** from `1:2:4` + `dry_factor` the app derives cement/sand/granite
  per m³. AI-read ratios are validated against a **known grade↔ratio table**
  (15→1:3:6, 20→1:2:4, 25→1:1.5:3 — editable) and flagged when they disagree (the sample
  mangles "1:3:6" as "1:3.6").
- **Formwork is not a consumable** (sample: 478 m² soffit formwork ≠ 478 m² of board
  bought): `reusable` + `reuse_count` make take-off honest.
- **Blockwork production route:** same output, two assemblies in one `alternative_group`
  — bought blocks, or site-molded (cement+sand → blocks). Chosen per work item at
  confirm; project-level override deferred.
- **Waste:** without `waste_factor`, every real building "over-consumes" vs BOQ and
  variance alarms become noise. Defaults ship editable (blocks 1.05, rebar 1.05,
  concrete 1.03, tiles 1.08 — org can tune).

### 3.4 Material conversions — `material_conversions`

```
id, org_id, material_id → materials_catalog,
from_unit text, to_unit text, factor numeric,   -- qty[to] = qty[from] × factor
source, verified_by
```

Seeded editable standards: sand 1.6 t/m³, granite 1.5 t/m³; rebar **tons ↔ 12 m pieces**
per diameter (Y8 4.74 kg, Y10 7.40 kg, Y12 10.66 kg, Y16 18.95 kg, Y20 29.6 kg, Y25
46.2 kg per length) — the store issues pieces, the BOQ measures tonnes; this conversion
is used daily, densities occasionally.

### 3.5 Labour rates

**v1:** `labour_rate` on the assembly / labour-kind work item (simple, one number).
**Phase 3:** dated `labour_rates` ledger mirroring `material_prices`
(`work_code/assembly_id, unit, rate, effective_from, entered_by`) with the same
conflict-chooser as prices. Cost stays `quantity × current rate, live` either way.

### 3.6 Work done — `building_work_actuals` (Phase 3)

```
id, building_id → buildings, work_item_id → type_work_items,
qty_done numeric, as_of date, note,
source, confidence, verified_by, idempotency_key
```

**v1 granularity: per stage** (reuse `building_stage_progress`); per-work-item actuals
arrive with this table in Phase 3 when EVM dashboards need them.

## 4. Live cost (how "true cost" is computed)

```
Work item estimate:
  material_supply → qty × current_price(material)                          (live)
  composite       → Σ over components:
                      consumable: qty × qty_per_unit × waste_factor × current_price
                      reusable:   qty × qty_per_unit / reuse_count × current_price
                    + qty × assembly.labour_rate                           (live)
  labour/plant    → qty × current labour/plant rate                        (live)
  provisional     → the provisional sum (until re-measured)

Building estimate = Σ work items by stage/element
                    + PRICED-SCOPE GAP: Σ unpriced work items × proposed rates (§6)
Building actual   = Σ material OUT × price + Σ labour/plant expenses (tagged to stage)
Variance / EVM    = planned vs earned (qty_done × unit cost) vs actual     (Phase 3)
```

The BOQ's own rate/amount is shown beside every computed figure as the **cross-check**;
a price or labour-rate change re-costs everything instantly (Rule 4).

## 5. Reconciliation — the import's headline

The bill contains its own answer key (the sample cross-casts to the kobo:
elements → ₦289,075,717.35). After extraction, a **deterministic** pass (code, not AI):

1. Per item: `qty × rate ≈ amount` → else flag `amount_mismatch`.
2. Per collection/element: Σ items ≈ stated collection/summary → else flag section.
3. Grand: Σ extracted ≈ stated grand total; report VAT/WHT lines as stated (the sample
   never adds its VAT line — record what the document *says*, don't "fix" it).
4. Anomaly flags: unknown unit, text-coerced qty, unresolved ditto, near-duplicate scope
   (same qty+rate+similar text), rate outliers vs org history.

Stored in `boq_imports.reconciliation` and rendered as the review banner:

> **Extracted 143 items · Σ = ₦289,065,000 vs bill's ₦289,075,717 (−0.004%) ·
> 2 sections off · 4 rows flagged**

This one line is what makes a human trust — or catch — the extraction. Confirm is never
blocked by variance; it is surfaced. Machine flags, not model self-scores, are the
review sort key (Rule 2's `confidence` is stored, but objective checks rank first).

## 6. Priced vs unpriced scope — first-class

The sample's ₦280m total excludes floor finishes (1,039 m² tiles), painting (3,462 m²),
POP ceilings (950 m²), wall tiles (840 m²), most doors, fittings, sanitary ware, wiring
— plausibly ₦40–60m of measured-but-unpriced scope, plus ₦5.78m preliminaries with no
breakdown and provisional sums. Anyone "building to the BOQ total" runs out of money
before tiles and paint. So:

- Every measured item with no rate imports as a work item with `is_priced=false` —
  **never skipped** (they are the missing-money story).
- The recipe/building view shows three numbers, always: **BOQ priced total** ·
  **unpriced scope** (count + our estimated value) · **true estimate** (priced + our
  build-up of unpriced + prelims/provisionals as their own lines).
- **The killer feature:** SiteLens *proposes* rates for unpriced items from its own
  assemblies + price list (`fn_propose_work_item_rates`) — as proposals a human accepts
  (Rule 3). No contractor spreadsheet does this.
- Preliminaries import as a stage-less `other` work item group (time-related, spread over
  duration in the planner — not per-stage material).

## 7. Price & labour proposals — guardrails

BOQ rates are **all-in composite rates** (labour+material+plant+OH&P). ₦18,300/m²
blockwork is not a block price; ₦195,000/m³ concrete is not cement. Therefore:

- Only `material_supply`-kind rows may generate `material_prices` proposals — and even
  those are labelled "all-in BOQ rate (includes delivery/labour)" in the chooser.
- `composite`/`labour`/`plant` rates seed **labour-rate / assembly-rate** proposals
  instead (the residual after material build-up is the implied labour+OH&P — shown to
  the user, never auto-committed).
- Existing-vs-new conflicts always render the side-by-side chooser (BOQ_INTELLIGENCE §C
  flow); accepting calls `fn_set_material_price` / labour equivalent. Never silently
  overwrite (Rule 3).

## 8. Unit normalization (deterministic dictionary)

Applied in code at staging; unknown units flag, never guess:

```
m2 ← m2, sq.m, Sq.m, Sq.m., Sq,m, SQM, sm         m3 ← m3, cu.m, Cu.m, CUM
t  ← ton, tons, Tons, Ttons, tonne                nr ← nr, Nr, Nrs, Nos, nos, no
m  ← m, lm, Lm, l.m, L.m (flag: linear)           item ← item, Item, ltem
kg, bag, set, sum, pair → themselves
```

Original unit text is preserved on the staging row; the normalized unit goes to the work
item. Unit mismatch vs the mapped material's stock unit routes through
`material_conversions` (§3.4) or flags.

## 9. Phase 0 — live bug hotfix (ship first, independent of the rest)

Two verified bugs in `fn_confirm_boq_import` (migration `20260727180000_m1f_boq_confirm.sql`),
live in cloud today:

1. **Quantity overwrite:** upsert `ON CONFLICT … DO UPDATE SET quantity = EXCLUDED.quantity`
   means two BOQ lines mapping to the same (stage, material) keep only the LAST quantity.
   Sample impact: five substructure rebar lines (Σ ≈ 8.98 t) confirmed to one
   "Reinforcement" material leave the recipe holding **0.89 t**.
   **Fix:** pre-aggregate `p_confirmations` by (stage_id, material_id) summing quantity
   inside the function, then upsert with replace semantics — sums within an import,
   idempotent on re-run, replace on re-import.
2. **NULL-stage duplicates:** `uq_type_boq_item` is a plain unique index → NULL stage_ids
   are distinct → stage-less confirms bypass ON CONFLICT and duplicate on re-run.
   **Fix:** recreate the index `NULLS NOT DISTINCT` (PG15) — or require a stage; index
   fix preferred, recipes may legitimately hold unstaged items.

Plus a small guard: `BoqReview` currently defaults every row to `stages[0]` and
`include=true` — flip to "unassigned" default so the human *places* items (Rule 3 in
spirit, cheap change, stops silent mis-staging today).

Test: extend `ac5_boq_import.sql` — two rows→one material SUM; re-run → no change;
NULL-stage re-run → no duplicate.

## 10. Extraction pipeline v2 (both lanes, one brain)

```
Excel/CSV ──(browser: SheetJS grid — keep; no OOM)──► grid rows as text ─┐
PDF ────────(file content type, native engine)──────────────────────────┤
Photo/scan ─(image_url vision)──────────────────────────────────────────┤
                                                                        ▼
              PASS 1 — SEGMENT (AI, structured output):
              classify every row → row_kind; detect elements/sections;
              emit segment boundaries + stated totals (collections/summaries)
                                                                        ▼
              PASS 2 — EXTRACT per segment (AI, chunked; solves output-token
              truncation on 30-page bills): items with boq_ref, resolved dittos
              (parent context carried in), qty/unit/rate/amount, suggested kind
              + stage + material guess + mix_ratio, per-field confidence.
              Prompt encodes the grammar of §2: ignore narrative quantities,
              notes are not items, keep raw text verbatim + resolved text.
                                                                        ▼
              PASS 3 — VALIDATE (deterministic CODE, not AI):
              unit dictionary, qty coercion, arithmetic per item/section/grand,
              duplicate-scope + rate-outlier flags → flags[] + reconciliation
                                                                        ▼
              fn_stage_boq_rows_v2 (all rows incl. check rows, kinds, flags)
                                                                        ▼
              REVIEW v2 (§11) → fn_confirm_boq_import_v2 → work items (+
              assembly/material/stage links) + price/labour-rate proposals
```

- Structured outputs (JSON schema via OpenRouter) replace `text.slice(indexOf("["))`.
- Model stays config (`AI_BOQ_MODEL`); `DEV_AI_MODE` fixture becomes a canned extraction
  of the real sample (sanitized) so tests exercise the true document class.
- The spreadsheet lane no longer bypasses the brain: positional structure needs the same
  intelligence as PDFs; the grid-as-text route is cheap (no vision) and keeps the
  browser parse that fixed the 546 OOM.

## 11. Review UX v2 (the human-disposal gate that actually works)

A 200-row flat table guarantees rubber-stamping. Redesign:

- **Reconciliation banner** (§5) at top, always.
- **Grouped by element → section**, collapsible, with per-section extracted-vs-stated
  totals; **bulk-accept a clean section** in one click.
- **Risk-first queue:** flagged rows (machine flags → low field-confidence → unmapped
  material → unassigned stage) float to a "needs you" list; clean rows sit below.
- **Full description visible** (no truncation — the material name lives mid-sentence).
- **Split-row:** one composite line → assembly pick → preview of derived materials; or
  manual split into multiple material lines.
- **Stage defaults to element-derived suggestion, "unassigned" when unsure** — never
  silently `stages[0]`.
- **Unpriced panel** (§6): count + list + "propose rates from my price book".
- Confirm shows what will be written (N work items, M aliases, K price proposals) before
  it happens.

## 12. Implementation plan

> Founder gate between phases. Phase 0 is a hotfix and should go out first. The BOQ
> build runs alongside M8 (operational pilot) at the founder's direction.

### Phase 0 — hotfix (small; 1 migration + 1 component edit)
- Migration `boq_confirm_fixes`: aggregate-then-upsert in `fn_confirm_boq_import`;
  recreate `uq_type_boq_item` with `NULLS NOT DISTINCT`.
- `BoqReview`: stage default → unassigned; include default stays but "confirm all
  unflagged" becomes explicit.
- Tests: extend `ac5_boq_import.sql` (sum, idempotent re-run, NULL-stage no-dup).
- **Gate:** extended AC-5 suite green; re-confirming the sample's rebar rows yields the
  summed tonnage.

### Phase 1 — faithful decode (extraction v2 + staging + reconciliation + review v2)
- Migration `boq_staging_v2`: §3.1 columns on `boq_import_rows`/`boq_imports`;
  `fn_stage_boq_rows_v2`; unit dictionary applied in staging.
- Edge fn `boq-extract` v2: three-pass pipeline (§10), chunked, structured output,
  grid-text route for spreadsheets; keep `boq-extract-pdf` name/route if simpler.
- Web: wizard sends grid text through the brain; `BoqReview` v2 (§11) minus the
  assembly/split features (Phase 2) — grouping, flags, reconciliation banner, unpriced
  panel (display only), full text, section bulk-accept.
- `DEV_AI_MODE` fixture from the sample; test suite for pass 3 (pure functions).
- **Gate (uses the real NPC Xora Bay file):** end-to-end import stages **zero** junk
  rows as items; all 15 elements auto-grouped; dittos resolved; reconciliation within
  0.5% of ₦289,075,717.35 with every flagged row explained; unpriced scope reported
  (≥ the 4 zero-elements + NOT-APPLICABLE items).

### Phase 2 — true-cost layer (work items, assemblies, take-off, proposals)
- Migrations: `type_work_items` (§3.2), `assemblies`+`assembly_components` (§3.3),
  `material_conversions` (§3.4 seeded), write fns (`fn_upsert_assembly`,
  `fn_confirm_boq_import_v2` → work items, `fn_propose_prices_from_import` with §7
  guardrails, `fn_propose_work_item_rates` for unpriced scope).
- Ratio→components derivation + grade↔ratio sanity table; formwork reuse; waste factors;
  blockwork alternative routes.
- Web: review v2 split-row/assembly pick; recipe page shows work items by stage with
  live build-up vs `boq_rate` variance; three-number scope header (§6); price/labour
  conflict choosers on the AI proposals page.
- Tests: take-off math (mix → materials with waste/reuse/conversions), price-proposal
  guardrails (composite rows must NOT reach `material_prices`), RLS + idempotency on all
  new fns, live re-cost on price change (AC-7 tie).
- **Gate:** the sample imports into a recipe whose computed materials+labour build-up
  reconciles to the bill; changing the cement price re-costs the building live; a
  composite rate can never enter the price list.

### Phase 3 — work-done & earned value
- Migrations: `building_work_actuals` (§3.6), dated `labour_rates` ledger (§3.5),
  `fn_log_work_done` (idempotent), EV views.
- Web: per-building EVM — planned vs earned vs actual by stage/element; overrun flags
  tied to the existing AC-9 seam.
- **Gate:** on a live building, earned value from logged work-done matches hand
  calculation; actuals pull from existing material OUT + expenses; variance visible per
  stage.

## 13. Decisions taken (v1 open questions → defaults; veto anytime)

| # | Question | Decision |
|---|---|---|
| 1 | Densities m³↔ton | Ship editable standards, seeded (§3.4) — plus rebar piece conversions |
| 2 | Labour rates | Per-assembly/work-item in v1; dated ledger in Phase 3 |
| 3 | Work-done granularity | Per-stage v1; per-work-item with Phase 3 |
| 4 | Provisional / unpriced | Always import as placeholders — never skip (§6) |
| 5 | BOQ rate vs computed cost | Our live build-up is the estimate; QS figure shown as reference + variance |
| 6 | (new) Waste defaults | Ship editable defaults (§3.3) |
| 7 | (new) Formwork | Reusable component with reuse_count, default 6 |
| 8 | (new) Block route | Alternative assemblies, picked per work item |

## 14. Rules compliance

- **Rule 1:** all new tables RLS-on, zero client write policies; every write path is a
  `SECURITY DEFINER` fn (`fn_stage_boq_rows_v2`, `fn_confirm_boq_import_v2`,
  `fn_upsert_assembly`, `fn_log_work_done`, proposal fns).
- **Rule 2:** every extracted/derived value carries `source/confidence/model_id/
  verified_by`; machine validation flags stored alongside.
- **Rule 3:** extraction, stage suggestions, material maps, mix ratios, price and labour
  rates, proposed rates for unpriced scope — all proposals; nothing auto-commits.
- **Rule 4:** quantity from design/mix; price & labour from dated lists; cost always
  computed live; `boq_rate` is reference only, everywhere it appears.
