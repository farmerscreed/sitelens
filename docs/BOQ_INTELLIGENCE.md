# BOQ_INTELLIGENCE — the "powerful brain" behind BOQ import (planned)

BOQ population is the keystone of SiteLens: it turns a builder's bill of quantities into a
reusable, correctly-staged recipe that everything else (cost, materials, planning, portal)
computes from. This doc specs the intelligence layer the founder asked for. **Status:
specced, not yet built.** Today's flow already works (upload → extract/parse → review →
confirm); this makes it smart, correct, and easy.

## Goals (from founder feedback, 2026-07-30)
1. The AI should **read the document, validate its formatting, and place each item in the
   right construction stage** — not just dump rows.
2. The flow must be **easy** and never dead-end: if there's no recipe yet, guide the user to
   create one first (done); make each step obvious.
3. **Data correctness is paramount** — every extracted value is a proposal a human confirms,
   with confidence and clear flags for anything doubtful.
4. **Auto-populate the price list** from BOQ rate columns. When a material already has a
   price (or a new import brings a different rate), **the user decides which value to keep**
   — never silently overwrite.

## Proposed design

### A. Smarter extraction + auto-staging
- Extend the extraction prompt/schema so each row also returns a **suggested stage**
  (mapped to the target recipe's stage names) and a **normalised material guess** + unit,
  each with its own confidence.
- Server-side, reconcile suggested stages against the recipe's actual `type_stages`
  (fuzzy match on name/sequence); unmatched → "unassigned" for the human to place.
- Normalise units and quantities; flag rows whose numbers look malformed (letters in a
  quantity, missing unit, absurd magnitude) so the reviewer sees them first.

### B. Correctness gates in review
- Rank the review list by risk: unmapped material → low confidence → unit/qty anomaly first.
- Show the extractor's confidence per field; require a human tick before confirm (already
  the case). Remember material-name → catalogue mappings per org so repeat imports get
  easier (the column-mapping memory already exists; extend to material aliases).

### C. Price-list population from BOQ rates (with human-chosen conflict resolution)
- When a BOQ has a **rate** column, propose each rate as a dated price for the mapped
  material — as **proposals**, not direct writes (prices stay server-function-only, Rule 1).
- If a material already has a current price that differs, present **both values side by
  side** (existing vs BOQ) and let the user pick which becomes current (or keep both in the
  dated history). Never auto-overwrite.
- Likely shape: a `fn_propose_prices_from_import(import_id)` producing `ai_inferences`
  proposals, surfaced on the AI proposals page and/or inline in review; accepting calls the
  existing `fn_set_material_price`. Conflicts render as a chooser.

## Data / surfaces touched
- Edge: `boq-extract-pdf` (+ `boq-parse`) — richer schema (stage + material + unit guesses,
  per-field confidence).
- DB: extend BOQ staging to carry suggested stage + a price proposal path
  (`fn_propose_prices_from_import`), reuse `fn_set_material_price` on accept. New migration(s).
- Web: `BoqReview` — risk-ranked rows, confidence chips, stage auto-fill, and a
  price-conflict chooser. Keep everything a confirm-before-commit proposal (Rule 3).

## Guardrails (unchanged rules this must respect)
- AI proposes, humans dispose (Rule 3): nothing auto-commits — not rows, not prices.
- Prices/quantities server-function-only (Rule 1); quantity from design, price from market,
  cost computed live (Rule 4). Every extracted value keeps source + confidence (Rule 2).

## Done already (foundation)
- **Spreadsheets parse in the BROWSER** (2026-07-30): the `boq-parse` edge function was
  546-ing (worker terminated — SheetJS memory limit) on real `.xlsx` files (small CSVs
  passed; binary Excel OOM'd the edge runtime). Now Excel/CSV are read client-side with
  SheetJS (no memory limit / cold start) and staged via direct RPC calls
  (`fn_create_boq_import`/`fn_stage_boq_rows`/`fn_remember_column_mapping`, all granted to
  authenticated). PDF/photo still go server-side (AI vision needs the key). Remembered
  column mapping auto-applies per header layout.
- **Multi-format upload with auto-detection** (2026-07-30): Excel/CSV (parsed, no AI),
  PDF (AI vision via the `file` content type + OpenRouter native pdf engine), and
  **photos/scans jpg/png/webp** (AI vision via image_url). The wizard detects the format
  from the file and shows a badge; the edge fn routes by mime. → stage rows → review →
  confirm into recipe. Column-mapping memory per org.
- **Fixed** the PDF "non-2xx": PDFs were sent as `image_url` with media_type
  application/pdf, which Claude rejects (images must be jpeg/png/gif/webp) — now sent as a
  `file` part. CORS fixed earlier so uploads reach the function. Wizard now surfaces the
  edge function's real error body instead of a generic "non-2xx".
- Wizard guides to create a recipe first when none exists.

## Still to build (the "brain" — see Proposed design above)
Auto-stage assignment, price-list population from BOQ rate columns with a human
conflict-chooser, risk-ranked correctness gates, material-alias memory.
