# M3 plan — Feasibility planner (cash-flow engine) + scenarios

> Milestone line flipped M2→M3. Building through per the founder's instruction.

## Gate (AC-8)
The planner returns a **correct period-by-period cash requirement, peak, and total** for
a **staggered, multi-type, multi-batch** plan. Recompute across a 300-building plan
< 5 s (NF-13). Results are **computed live** so a price change updates every saved
scenario (F-PLAN-6, ties to AC-7).

## PRD basis
§7 (planning module, web-first): §7.1 funding-required (F-PLAN-1..4), §7.2 max-delivery
(F-PLAN-5), §7.3 scenarios (F-PLAN-6). §16.4 `fn_compute_feasibility(plan_id)`. Tables
`plans` / `plan_lines` already exist (M0). Reuses M1 `current_price`/`fn_type_cost` and
per-stage costs, and M2's stage model.

## The model (implementable + testable)
- **Inputs (stored):** `plan_lines` = (building_type, quantity, target_stage, batch_hint).
  `plans.assumptions` JSONB = `{ period_unit, period_days, batches: {hint:{start}},
  default_stage_periods }`. `plans.inflows` = `[{period, amount}]`. `plans.available_cash`
  (max-delivery).
- **Cost per stage per type** = Σ(`type_boq_items` qty × `current_price`) +
  Σ(`type_stage_costs`) for that stage — live.
- **Timeline:** each line's batch starts at `batches[hint].start`; stages run
  sequentially, each lasting `ceil(expected_days/period_days)` periods (default 1). A
  stage's cost × quantity is incurred at the period it starts. **Quantity is a
  multiplier, not a per-building loop** → O(lines × stages), fast for 300 (NF-13).
- **Outputs (`fn_compute_feasibility` → JSONB):** `periods[] = {period, outflow,
  cumulative, inflow, net_cumulative}`, `total_funding`, `peak_period_requirement`
  (max single-period outflow — the number that drops when you stagger, F-PLAN-4),
  `peak_funding` (max cumulative net of inflows — capital you must have provided at the
  worst point). **Both peaks are returned** — see Decision 1.

## Workstreams
- **A — plan write path:** `fn_create_plan`, `fn_set_plan_line` (upsert),
  `fn_update_plan` (assumptions/inflows/available_cash). Manager-gated; plans/plan_lines
  have no client write policy (Rule 1).
- **B — the engine:** `fn_compute_feasibility(plan_id)` (funding-required) and
  `fn_max_delivery(plan_id)` (F-PLAN-5: given available_cash + inflows, how many units of
  the plan's type mix fit to the target stage). Read-only, gated on plan-org membership.
- **C — tests (the gate):** AC-8 on a hand-computed staggered 2-type/2-batch plan
  (exact period outflows, total, both peaks); staggering lowers `peak_period_requirement`
  (F-PLAN-4); a price change re-costs the saved plan live (AC-7 tie); max-delivery
  arithmetic; authz; a 300-quantity recompute sanity (NF-13).
- **D — planner UI (web, §7):** create/edit a plan, add lines, set batch starts +
  period unit, optional inflows; render the cash-flow timeline (period table + peak +
  total); a max-delivery view; save/compare scenarios.

## Files
```
supabase/migrations/2026…_m3a_plans.sql        fn_create_plan, fn_set_plan_line, fn_update_plan
supabase/migrations/2026…_m3b_feasibility.sql  fn_compute_feasibility, fn_max_delivery
supabase/tests/ac8_feasibility.sql             the gate + max-delivery + authz + NF-13 sanity
apps/web/app/planner/…                          create plan, edit lines/assumptions, timeline, max-delivery
```

## Verification
`bash scripts/verify_all.sh` extended with `ac8_feasibility`; all prior suites stay
green. DB verified via docker exec; UI code-complete + typechecked.

## Decision (noted, non-blocking)
1. **"Peak funding requirement" is ambiguous in the PRD** — could mean the max
   single-period cash need (drops with staggering, F-PLAN-4) or the max cumulative
   capital outstanding (net of inflows). We return **both** (`peak_period_requirement`
   and `peak_funding`) so the UI can show whichever the founder means; documented in
   DECISIONS. If they want only one headline number, it's a one-line UI change.
