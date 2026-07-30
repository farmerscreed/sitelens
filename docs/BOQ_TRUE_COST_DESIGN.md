# BOQ → TRUE-COST MODEL — design (for review, not yet built)

**Status: DESIGN ONLY.** No schema or code written yet. This spec is for the founder to
review and approve before any migration. Supersedes the "Proposed design" in
`docs/BOQ_INTELLIGENCE.md` (which stays as the extraction/UX foundation notes).

## 1. The goal (founder, 2026-07-30)
Import a real QS Bill of Quantities and use it to know and monitor the **true cost of a
building — materials AND labour — from start to finish**. Three linked layers:

1. **Work items** — the BOQ's measured lines (e.g. *Grade 15 concrete, 19 m³*; *Excavate
   trench, 177 m³*). Grouped by element/stage. Carry the QS rate; drive **work-done**.
2. **Mixes / assemblies** — the ratio rules that turn a work quantity into raw materials
   (Grade 20 = 1:2:4 → cement + sand + granite per m³) plus a labour component.
3. **Raw materials** — cement, sand, granite, steel — the stock already tracked.

One BOQ line flows through all three:
> *Grade 15 concrete, 19 m³* → **1:3:6 mix** → *≈ 85 bags cement + ~8 m³ sand + ~16 m³
> granite* (illustrative; from the ratio the AI reads off the BOQ) → priced live from the
> price list → **+ placing labour** → true cost of that concrete, tracked as it's poured.

**Decisions locked in:** Hybrid model (work-items faithful + materials where clean +
composites via mixes). Do **both** cost and stock, **plus** work-done tracking. **Mix
ratios are read from the BOQ by AI**, falling back to an editable standard when the
document doesn't state them.

## 2. Why the sample is hard (and why AI, not regex)
From the founder's real BOQ (2-bed stretched terrace, PH): title/summary/VAT pages before
any item; repeating `S/N DESCRIPTION QTY UNIT RATE AMOUNT` headers; **preamble rows that
look like items** (notes A–C: "Soil test report was not available…"); section headers that
are really **stages** (`SUBSTRUCTURE`, `E10: MIXING/CASTING INSITU CONCRETE`,
`REINFORCEMENT…`); non-sequential S/N (A, B, L1, M); **unit chaos** (`m2`,`m3`,`Cu.m`,
`sq.m`,`Item`,`ltem`); and **materials implied inside work descriptions** ("1630mm **Sharp
sand** deposited, well rammed…", "High yield **reinforcement bar** to BS 4449", "75mm
**concrete grade 15** blinding"). No fixed columns/pattern → an LLM that understands QS
structure is the right tool. Every output stays a proposal a human confirms (Rule 3).

## 3. Data model (new + extended tables)
All follow SiteLens conventions: UUIDv7 PK, `idempotency_key` on mutation tables, RLS on
every table, writes only via `SECURITY DEFINER` functions (Rule 1), money `NUMERIC`,
observed values carry `source/confidence/model_id/verified_by` (Rule 2).

### 3.1 Work items — `type_work_items`
The BOQ's measured lines, attached to a recipe (`building_types`) and a stage.
```
id, building_type_id → building_types, stage_id → type_stages (nullable = "unassigned"),
element_name        text     -- BOQ grouping verbatim, e.g. "E10 INSITU CONCRETE"
boq_ref             text     -- the S/N as written ("L1", "M")
description         text     -- QS text verbatim (a fact)
quantity           numeric
unit               text      -- normalised (m3, m2, nr, item, kg, t)
kind               enum('material_supply','composite','labour','plant','provisional','other')
assembly_id        → assemblies      (nullable; set for composite / mix-based)
material_id        → materials_catalog(nullable; set for direct material_supply)
boq_rate           numeric  -- the QS all-in rate, kept for reference/variance ONLY
source, confidence, model_id, verified_by, created_at
```
> **Rule 4 kept:** `boq_rate` is *reference*, never the live cost driver. Live cost is
> recomputed from materials (× current price) + labour (× current labour rate). The QS
> rate seeds proposals for those lists but is never the frozen source of cost.

### 3.2 Mixes / assemblies — `assemblies` + `assembly_components`
Reusable, org-level. A composite work item points at an assembly.
```
assemblies:  id, org_id, name ("Concrete grade 20 (1:2:4)"), unit (m3|m2|nr),
             kind (concrete|blockwork|mortar|render|custom),
             ratio text (e.g. "1:2:4"), dry_factor numeric default 1.54,
             labour_rate numeric (₦ per unit, optional), plant_rate numeric (optional),
             source, confidence, model_id, verified_by
assembly_components: id, assembly_id, material_id → materials_catalog,
             qty_per_unit numeric, unit text   -- e.g. per m³: cement 7 (bag), sand 0.42 (m3)
```
- **From ratio → components:** given `1:2:4` by volume and `dry_factor`, the app derives
  qty_per_unit for cement/sand/granite. AI reads the ratio/grade off the BOQ; if absent,
  the user picks an editable standard (grade 15/20/25…). Components can also be entered
  directly for non-concrete assemblies (blockwork, render).
- **Unit conversion:** materials priced/stocked in `ton` but mixed by `m³` need a density
  (sand ≈1.6 t/m³, granite ≈1.5 t/m³). Store a `density`/conversion on the material (or the
  component) so m³→ton is exact. (Open question 6.1.)

### 3.3 Labour rates — `labour_rates` (dated, like `material_prices`)
So labour cost is "quantity × current rate, computed live" — same discipline as materials.
```
labour_rates: id, org_id, work_code text (or assembly_id/kind), unit, rate numeric,
              effective_from date, entered_by
```
- Cost of a labour/plant work item = quantity × current labour rate (live, dated).
- The BOQ's rate seeds a **proposal** here (accept → `fn_set_labour_rate`), with the same
  conflict-chooser as material prices when a rate already exists.
- **v1 simplification option:** start with labour on the assembly / work item and add the
  dated `labour_rates` list in Phase 3 (Open question 6.2).

### 3.4 Work done — `building_work_actuals`
Earned-value per building, per work item.
```
building_work_actuals: id, building_id → buildings, work_item_id → type_work_items,
             qty_done numeric, as_of date, note, source, confidence, verified_by,
             idempotency_key
```
- Drives **earned value** = qty_done × unit cost (materials+labour). Compared to **actual
  cost** = material consumption (existing OUT `material_transactions` × price) + labour
  expenses (existing `expenses`, tagged to the work item/stage).
- **v1 option:** track at stage granularity first (reuse `building_stage_progress`), add
  per-work-item actuals when needed (Open question 6.3).

### 3.5 Extraction staging (extend existing)
Reuse `boq_imports` + `boq_import_rows`, add columns so a row can propose a work item, a
material mapping, an assembly/mix, a stage, and a rate — each with confidence — before
`fn_confirm_boq_import` writes work items / assemblies / rate proposals. Nothing
auto-commits (Rule 3).

## 4. Live cost (how "true cost" is computed)
```
Work item cost (estimate):
  material_supply → quantity × current_price(material)                 (live)
  composite       → Σ(assembly_components.qty_per_unit × quantity × current_price(mat))
                    + quantity × assembly.labour_rate                  (live)
  labour/plant    → quantity × current labour/plant rate               (live)

Building estimate = Σ work items, grouped by stage/element.
Building actual   = Σ material OUT × price  +  Σ labour/plant expenses.
Variance / EVM    = planned value (scheduled) vs earned value (qty_done × cost) vs actual.
```
Because everything is `quantity × current rate`, a price or labour-rate change re-costs
every building and plan instantly (Rule 4). The BOQ's own rate/amount is shown alongside as
a **cross-check** (the sample totals ₦280m — we can reconcile our computed total to it).

## 5. Worked example (from the founder's BOQ)
| BOQ line | kind | becomes |
|---|---|---|
| *Clearing of site … 728 m² @ 300* | labour | labour work-item, rate → labour-rate proposal |
| *Excavate trench … 177 m³ @ 3,500* | labour/plant | work-item, no material |
| *1630mm Sharp sand … 713 m³ @ 11,100* | material_supply | material = **Sharp sand**, 713 m³ → ton via density; rate → price proposal |
| *75mm concrete grade 15 blinding, Column bases 19 m³ @ 170,690* | composite | assembly **Grade 15 (1:3:6)** → cement+sand+granite per m³ × 19; + placing labour |
| *High yield reinforcement bar BS 4449 (no qty)* | material_supply / provisional | material = **Reinforcement Y12**; flagged (qty blank in sample) |
| *Notes A–C ("Soil test report was not available…")* | — | **skipped** (preamble) |
| *"To Collection", "Page 3", "SUB-TOTAL"* | — | **skipped** (structure/footers) |

## 6. Open questions (please decide before build)
1. **Material densities** for m³↔ton (sand/granite): ship standard values (editable) or you
   enter them?
2. **Labour rates:** dated org list from the start, or per-assembly/work-item in v1?
3. **Work-done granularity:** per work-item (true EVM) or per-stage first?
4. **Provisional items** (the BOQ marks substructure "ALL PROVISIONAL", and some rows have
   blank qty): import as provisional placeholders to fill later, or skip until quantified?
5. **BOQ rate vs our computed cost:** when they differ (they will), which is "the estimate"
   — our live build-up, the QS figure, or show both with the variance? (Recommend: our
   live build-up is the estimate; QS shown as reference.)

## 7. Build phases (once approved)
- **Phase 1 — Smart extraction:** AI segment/classify/stage/map-material/read-mix + capture
  work-items & rates → review → confirm. Faithful import + live cost (materials + BOQ rate
  as reference). Tables: `type_work_items`, extend staging.
- **Phase 2 — Mixes & take-off:** `assemblies`/`assembly_components`, AI-read ratios with
  editable-standard fallback, m³↔ton conversion, auto material take-off, `labour_rates`.
- **Phase 3 — Work-done & true cost:** `building_work_actuals`, earned-value vs actual
  (materials + labour) dashboards per building and stage.

## 8. Rules compliance
Rule 1 (server-only writes), Rule 2 (source/confidence on every observed value), Rule 3 (AI
proposes, human confirms — extraction, mixes, material maps, rates all reviewed), Rule 4
(quantity from design/mix, price & labour rate from dated market lists, cost live; BOQ rate
is reference only). No schema is built until this doc is approved.
