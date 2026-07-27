-- ═══════════════════════════════════════════════════════════════════════════
-- M3 gate — AC-8: the planner returns a correct period-by-period cash requirement,
-- peak, and total for a staggered multi-type, multi-batch plan. Also: staggering
-- lowers the peak-period need (F-PLAN-4), price changes re-cost live (F-PLAN-6/AC-7),
-- max-delivery arithmetic (F-PLAN-5), authz, and a 300-qty recompute sanity (NF-13).
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/ac8_feasibility.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';  -- seeded cement @ 9500
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  eng    uuid := 'e1111111-1111-1111-1111-111111111111';
  tA uuid; tB uuid; tP uuid; sPf uuid;
  aF uuid; aR uuid; bR uuid;
  plan uuid; planP uuid; planM uuid;
  r jsonb; m jsonb; fails int := 0; v numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Type A: Foundation 100k, Roof 200k (each 1 week).
  tA := fn_create_building_type(org_a, 'Plan Type A', 'terrace');
  aF := fn_add_type_stage(tA, 'Foundation', 1, 7);
  aR := fn_add_type_stage(tA, 'Roof', 2, 7);
  PERFORM fn_set_type_stage_cost(tA, aF, 'labour', 100000);
  PERFORM fn_set_type_stage_cost(tA, aR, 'labour', 200000);
  -- Type B: Foundation 50k, Roof 150k.
  tB := fn_create_building_type(org_a, 'Plan Type B', 'duplex');
  PERFORM fn_add_type_stage(tB, 'Foundation', 1, 7);
  bR := fn_add_type_stage(tB, 'Roof', 2, 7);
  PERFORM fn_set_type_stage_cost(tB, (SELECT id FROM type_stages WHERE building_type_id=tB AND name='Foundation'), 'labour', 50000);
  PERFORM fn_set_type_stage_cost(tB, bR, 'labour', 150000);

  -- Staggered plan: 2×A from period 0, 3×B from period 2.
  plan := fn_create_plan(org_a, 'Staggered', 'funding_required', NULL, NULL, NULL,
    '{"period_unit":"week","period_days":7,"batches":{"B1":{"start":0},"B2":{"start":2}}}'::jsonb);
  PERFORM fn_set_plan_line(plan, tA, 2, aR, 'B1');
  PERFORM fn_set_plan_line(plan, tB, 3, bR, 'B2');

  r := fn_compute_feasibility(plan);

  -- Expected per-period outflow: p0=200k, p1=400k, p2=150k, p3=450k.
  IF (r->'periods'->0->>'outflow')::numeric <> 200000 THEN RAISE WARNING 'p0=% (exp 200000)', r->'periods'->0->>'outflow'; fails:=fails+1; END IF;
  IF (r->'periods'->1->>'outflow')::numeric <> 400000 THEN RAISE WARNING 'p1=% (exp 400000)', r->'periods'->1->>'outflow'; fails:=fails+1; END IF;
  IF (r->'periods'->2->>'outflow')::numeric <> 150000 THEN RAISE WARNING 'p2=% (exp 150000)', r->'periods'->2->>'outflow'; fails:=fails+1; END IF;
  IF (r->'periods'->3->>'outflow')::numeric <> 450000 THEN RAISE WARNING 'p3=% (exp 450000)', r->'periods'->3->>'outflow'; fails:=fails+1; END IF;
  IF (r->>'total_funding')::numeric <> 1200000 THEN RAISE WARNING 'total=% (exp 1200000)', r->>'total_funding'; fails:=fails+1; END IF;
  IF (r->>'peak_period_requirement')::numeric <> 450000 THEN RAISE WARNING 'peak_period=% (exp 450000)', r->>'peak_period_requirement'; fails:=fails+1; END IF;
  IF (r->>'peak_funding')::numeric <> 1200000 THEN RAISE WARNING 'peak_funding=% (exp 1200000)', r->>'peak_funding'; fails:=fails+1; END IF;
  -- cumulative at p3 = total
  IF (r->'periods'->3->>'cumulative')::numeric <> 1200000 THEN RAISE WARNING 'cum p3 wrong'; fails:=fails+1; END IF;

  -- F-PLAN-4: un-stagger (B2 also starts 0) → peak-period rises (850k > 450k).
  PERFORM fn_update_plan(plan, NULL, NULL,
    '{"period_unit":"week","period_days":7,"batches":{"B1":{"start":0},"B2":{"start":0}}}'::jsonb);
  IF (fn_compute_feasibility(plan)->>'peak_period_requirement')::numeric <= 450000 THEN
    RAISE WARNING 'un-staggering did not raise peak-period'; fails:=fails+1; END IF;

  -- F-PLAN-6 / AC-7: a price change re-costs a saved plan live.
  tP := fn_create_building_type(org_a, 'Plan Type P', 'custom');
  sPf := fn_add_type_stage(tP, 'Only', 1, 7);
  PERFORM fn_set_type_boq_item(tP, sPf, mat_a, 10, 'bag');   -- 10 × current_price
  planP := fn_create_plan(org_a, 'Price test', 'funding_required');
  PERFORM fn_set_plan_line(planP, tP, 1, sPf, NULL);
  v := (fn_compute_feasibility(planP)->>'total_funding')::numeric;   -- 10 × 9500 = 95000
  IF v <> 95000 THEN RAISE WARNING 'price plan total=% (exp 95000)', v; fails:=fails+1; END IF;
  PERFORM fn_set_material_price(org_a, mat_a, 10000, CURRENT_DATE);  -- upsert today's price
  v := (fn_compute_feasibility(planP)->>'total_funding')::numeric;   -- 10 × 10000 = 100000
  IF v <> 100000 THEN RAISE WARNING 'plan did not re-cost on price change (got %)', v; fails:=fails+1; END IF;

  -- F-PLAN-5: max-delivery. Cash 1,000,000 + inflow 500,000; Type A full = 300,000/unit.
  planM := fn_create_plan(org_a, 'Max delivery', 'max_delivery', NULL, 1000000,
    '[{"period":2,"amount":500000}]'::jsonb);
  PERFORM fn_set_plan_line(planM, tA, 1, aR, NULL);   -- mix = 1 × A
  m := fn_max_delivery(planM);
  IF (m->>'available')::numeric <> 1500000 THEN RAISE WARNING 'avail=% (exp 1500000)', m->>'available'; fails:=fails+1; END IF;
  IF (m->>'mix_cost')::numeric <> 300000 THEN RAISE WARNING 'mix_cost=% (exp 300000)', m->>'mix_cost'; fails:=fails+1; END IF;
  IF (m->>'multiplier')::int <> 5 THEN RAISE WARNING 'multiplier=% (exp 5)', m->>'multiplier'; fails:=fails+1; END IF;

  -- authz: a non-member (org B admin) cannot compute an org A plan.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN PERFORM fn_compute_feasibility(plan);
    RAISE WARNING 'non-member computed a plan'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- engineer cannot create a plan / set a line
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng)::text, true);
  BEGIN PERFORM fn_create_plan(org_a, 'nope', 'funding_required');
    RAISE WARNING 'engineer created a plan'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- NF-13 sanity: qty 300 is a multiplier, computes fine.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  PERFORM fn_set_plan_line(plan, tA, 300, aR, 'B1');
  IF (fn_compute_feasibility(plan)->>'total_funding')::numeric <= 0 THEN
    RAISE WARNING '300-qty recompute failed'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'AC-8 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-8 PASS: staggered timeline correct (periods/total/peaks); staggering lowers peak; price re-costs live; max-delivery; authz; 300-qty ok.';
END $$;
ROLLBACK;
SELECT 'AC-8 feasibility planner: PASS' AS result;
