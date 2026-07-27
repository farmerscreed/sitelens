-- ═══════════════════════════════════════════════════════════════════════════
-- M1 · A — AC-7: "Changing one material price re-costs every affected building/
-- batch/plan, with old reports unchanged." Cost is quantity × current_price,
-- computed live (Rule 4); prices are dated and append-only (never overwritten).
--
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/ac7_price_recost.sql
-- Runs inside BEGIN/ROLLBACK (repeatable, no seed pollution). RAISEs on failure.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Costable recipe fixtures in Org A's existing type "Terrace Type A" (btA):
-- 10 tons of a fresh test material + a ₦200,000 stage cost. Fresh material avoids
-- the seed's existing cement price.
INSERT INTO materials_catalog (id, org_id, name, unit)
VALUES ('ac700000-0000-0000-0000-0000000000a7',
        'a0000000-0000-0000-0000-0000000000aa', 'AC7 Test Rebar', 'ton');
INSERT INTO type_stages (id, building_type_id, name, sequence)
VALUES ('ac700000-0000-0000-0000-0000000000b7',
        'aaaa0000-0000-0000-0000-0000000000a1', 'AC7 Stage', 99);
INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit)
VALUES ('aaaa0000-0000-0000-0000-0000000000a1',
        'ac700000-0000-0000-0000-0000000000b7',
        'ac700000-0000-0000-0000-0000000000a7', 10, 'ton');
INSERT INTO type_stage_costs (building_type_id, stage_id, category, amount)
VALUES ('aaaa0000-0000-0000-0000-0000000000a1',
        'ac700000-0000-0000-0000-0000000000b7', 'labour', 200000);

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_t uuid := 'ac700000-0000-0000-0000-0000000000a7';
  mat_b uuid := 'b8888888-8888-8888-8888-888888888888';  -- org B's material
  bt_a  uuid := 'aaaa0000-0000-0000-0000-0000000000a1';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111'; -- Org A admin
  user_b uuid := 'b2222222-2222-2222-2222-222222222222'; -- Org B admin
  t numeric; n int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Baseline: no price yet → materials 0, total = stage cost only.
  SELECT total_cost INTO t FROM fn_type_cost(bt_a);
  IF t <> 200000 THEN RAISE WARNING 'baseline total=% (expected 200000)', t; fails:=fails+1; END IF;

  -- Price v1 = 5000/ton (past). Live cost = 10×5000 + 200000.
  PERFORM fn_set_material_price(org_a, mat_t, 5000, DATE '2026-02-01');
  SELECT total_cost INTO t FROM fn_type_cost(bt_a);
  IF t <> 250000 THEN RAISE WARNING 'after v1 total=% (expected 250000)', t; fails:=fails+1; END IF;

  -- Price v2 = 6000/ton (later, still past) → re-costs live.
  PERFORM fn_set_material_price(org_a, mat_t, 6000, DATE '2026-05-01');
  SELECT total_cost INTO t FROM fn_type_cost(bt_a);
  IF t <> 260000 THEN RAISE WARNING 'after v2 total=% (expected 260000)', t; fails:=fails+1; END IF;

  -- Future price v3 must NOT apply until its date (current_price uses today).
  PERFORM fn_set_material_price(org_a, mat_t, 99999, DATE '2030-01-01');
  SELECT total_cost INTO t FROM fn_type_cost(bt_a);
  IF t <> 260000 THEN RAISE WARNING 'future price leaked: total=% (expected 260000)', t; fails:=fails+1; END IF;

  -- All three dated rows preserved — nothing overwritten (F-PRICE-2).
  SELECT count(*) INTO n FROM material_prices WHERE org_id=org_a AND material_id=mat_t;
  IF n <> 3 THEN RAISE WARNING 'expected 3 dated price rows, found %', n; fails:=fails+1; END IF;

  -- Every price change audited (AC-12 for prices).
  SELECT count(*) INTO n FROM audit_log
   WHERE action='set_material_price' AND (after->>'material_id')::uuid = mat_t;
  IF n <> 3 THEN RAISE WARNING 'expected 3 audit rows, found %', n; fails:=fails+1; END IF;

  -- Authz 1: Org B admin cannot set an Org A price.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_set_material_price(org_a, mat_t, 1, CURRENT_DATE);
    RAISE WARNING 'authz: Org B admin set an Org A price'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Authz 2: Org A admin cannot price a material that is not in Org A.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  BEGIN
    PERFORM fn_set_material_price(org_a, mat_b, 1, CURRENT_DATE);
    RAISE WARNING 'authz: priced a material not in the org'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF fails > 0 THEN RAISE EXCEPTION 'AC-7 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-7 PASS: live re-costing; dated history preserved; future price deferred; authz + audit hold.';
END $$;

ROLLBACK;
SELECT 'AC-7 price re-costing: PASS' AS result;
