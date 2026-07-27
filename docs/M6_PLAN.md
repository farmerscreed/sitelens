# M6 plan — AI: duplicate-photo, OCR, quality gate, questions, reorder advice

> Milestone flipped M5→M6. Building through. The two gates are pure arithmetic (fully
> DB-verified); vision/LLM features go behind the OpenRouter router with `DEV_AI_MODE`
> stubs (no paid key, no external call in tests — CLAUDE.md).

## Gates (§17 M6)
- **AC-3:** a resubmitted old photo is flagged as a duplicate automatically.
- **Reorder advice matches remaining BOQ** (AI-9): remaining requirement (recipe − consumed)
  vs stock → order proposal.

## PRD basis
§11.4 P1 AI (AI-1 hash, AI-2/7 OCR, AI-3 quality, AI-8 questions, AI-9 reorder), §11.1–11.3
(source/confidence/model_id/verified_by; the inference loop capture→proposal→verdict; the
OpenRouter router — model is config). `ai_inferences`/`ai_models`/`report_embeddings` tables
exist (M0). Rule 3: AI proposes, humans dispose.

## Workstreams
- **A — AI-1 duplicate detection (no model):** `fn_phash_hamming(a,b)` (Hamming distance
  on `bit(64)`) + upgrade `fn_register_media` (M4) from exact-match to **near-duplicate**
  (Hamming ≤ threshold within a 90-day window) → sets `media.duplicate_of`. **AC-3.**
- **B — AI-9 reorder advice (no model):** `fn_reorder_advice(project)` → per material:
  required (Σ recipe over the project's buildings) − consumed (Σ material OUT) vs in-stock
  → `order_qty`. Arithmetic over M1 recipes + M5 balances. **Reorder gate.**
- **C — the inference loop (Rule 3, §11.2):** `fn_record_inference` (write an
  `ai_inferences` proposal with `confidence`/`cost_estimate`) and `fn_resolve_inference`
  (human accept/reject → `human_value` = training label, status accepted/rejected). Every
  AI feature logs a proposal a human disposes.
- **D — vision/LLM (edge, DEV_AI_MODE):** `receipt-ocr` (AI-2: vision → {amount,date,payee},
  cross-check the typed amount, record an inference); `ask` (AI-8: embed question →
  `fn_match_reports` pgvector retrieval → LLM answer). `fn_match_reports(project, embedding,
  k)` (cosine over `report_embeddings`). AI-3 quality gate is on-device (noted in the
  mobile scaffold). All behind `_shared/ai-router.ts`.
- **E — tests:** `ac3_duplicate_photo` (near-dup flagged, far not, outside-90d not),
  `m6_reorder_advice` (order_qty matches remaining BOQ), `m6_inference` (propose→resolve
  loop + pgvector match).
- **F — web UI:** a reorder-advice panel (materials), a pending-AI-proposals list
  (accept/reject), and a plain-language question box (`ask`).

## Files
```
supabase/migrations/2026…_m6a_ai.sql   fn_phash_hamming, fn_register_media (Hamming), fn_reorder_advice,
                                        fn_record_inference, fn_resolve_inference, fn_match_reports
supabase/functions/receipt-ocr/         AI-2 (OpenRouter vision + DEV_AI_MODE)
supabase/functions/ask/                 AI-8 (retrieval + LLM stub)
supabase/tests/                         ac3_duplicate_photo, m6_reorder_advice, m6_inference
apps/web/app/ask, app/materials panel   question box, reorder advice, proposals
```

## Verification
`bash scripts/verify_all.sh` + the three M6 suites; all prior suites stay green. Edge fns
code-complete (DEV_AI_MODE). DB verified via docker exec.

## Decisions (noted, recommended)
1. **Duplicate = Hamming distance ≤ 8 bits over `bit(64)` within 90 days.** Re-encoding a
   photo changes a few hash bits, so exact match (M4) misses real resubmissions; a small
   Hamming threshold catches them (AC-3) with low false positives.
2. **Reorder advice is total-remaining now; schedule-aware ("needs 300 by slab in 2 wks")
   is a refinement.** The gate is "matches remaining BOQ", which total remaining satisfies;
   the batch-schedule weighting can layer on later using M2 batches + M3 timing.
3. **AI features never auto-commit (Rule 3).** OCR/reorder/answers are `ai_inferences`
   proposals a human accepts/rejects; the verdict becomes the training label (the flywheel).
