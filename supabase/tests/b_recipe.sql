-- ═══════════════════════════════════════════════════════════════════════════
-- M1 · B — recipe write functions: build a type, cost it live, duplicate &
-- version independently, and enforce authz. Runs in BEGIN/ROLLBACK.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/b_recipe.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';  -- seeded cement @ 9500 today
  mat_b uuid := 'b8888888-8888-8888-8888-888888888888';  -- org B material
  user_a uuid := 'a1111111-1111-1111-1111-111111111111'; -- org A admin
  user_b uuid := 'b2222222-2222-2222-2222-222222222222'; -- org B admin
  typ uuid; typ2 uuid; typ3 uuid; stg uuid;
  t numeric; n int; fails int := 0; q numeric;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Build a recipe.
  typ := fn_create_building_type(org_a, 'Test Bungalow', 'bungalow');
  stg := fn_add_type_stage(typ, 'Foundation', 1, 14);
  PERFORM fn_set_type_boq_item(typ, stg, mat_a, 200, 'bag');
  PERFORM fn_set_type_stage_cost(typ, stg, 'labour', 300000);

  -- Live cost = 200 × 9500 + 300000.
  SELECT total_cost INTO t FROM fn_type_cost(typ);
  IF t <> 2200000 THEN RAISE WARNING 'recipe cost = % (expected 2200000)', t; fails:=fails+1; END IF;

  -- Upsert (not duplicate): change qty to 250.
  PERFORM fn_set_type_boq_item(typ, stg, mat_a, 250, 'bag');
  SELECT count(*) INTO n FROM type_boq_items WHERE building_type_id = typ;
  IF n <> 1 THEN RAISE WARNING 'expected 1 boq item after upsert, found %', n; fails:=fails+1; END IF;
  SELECT total_cost INTO t FROM fn_type_cost(typ);
  IF t <> 2675000 THEN RAISE WARNING 'after upsert cost = % (expected 2675000)', t; fails:=fails+1; END IF;

  -- Duplicate → independent copy with same children and same cost.
  typ2 := fn_duplicate_type(typ, 'Test Bungalow XL');
  IF (SELECT count(*) FROM type_stages WHERE building_type_id = typ2) <> 1
     OR (SELECT count(*) FROM type_boq_items WHERE building_type_id = typ2) <> 1 THEN
    RAISE WARNING 'duplicate did not clone children'; fails:=fails+1;
  END IF;
  IF (SELECT total_cost FROM fn_type_cost(typ2)) <> 2675000 THEN
    RAISE WARNING 'duplicate cost mismatch'; fails:=fails+1;
  END IF;
  -- Editing the copy must not touch the original.
  PERFORM fn_set_type_boq_item(
    typ2,
    (SELECT id FROM type_stages WHERE building_type_id = typ2 LIMIT 1),
    mat_a, 999, 'bag');
  SELECT quantity INTO q FROM type_boq_items WHERE building_type_id = typ;
  IF q <> 250 THEN RAISE WARNING 'editing the duplicate changed the original (qty %)', q; fails:=fails+1; END IF;

  -- New version → version+1, parent chain, children cloned.
  typ3 := fn_new_type_version(typ);
  IF (SELECT version FROM building_types WHERE id = typ3) <> (SELECT version + 1 FROM building_types WHERE id = typ)
     OR (SELECT parent_version_id FROM building_types WHERE id = typ3) <> typ THEN
    RAISE WARNING 'version chain wrong'; fails:=fails+1;
  END IF;
  IF (SELECT count(*) FROM type_boq_items WHERE building_type_id = typ3) <> 1 THEN
    RAISE WARNING 'version did not clone children'; fails:=fails+1;
  END IF;

  -- Material must belong to the org.
  BEGIN
    PERFORM fn_set_type_boq_item(typ, stg, mat_b, 1, 'bag');
    RAISE WARNING 'accepted a material from another org'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- Authz: an org B admin cannot create a type in org A.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_create_building_type(org_a, 'Sneaky', 'custom');
    RAISE WARNING 'org B admin created a type in org A'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  -- ...nor add a stage to org A's type.
  BEGIN
    PERFORM fn_add_type_stage(typ, 'Sneaky stage', 2);
    RAISE WARNING 'org B admin edited org A type'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'B recipe test FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'B PASS: recipe build+cost, upsert, duplicate/version independence, authz.';
END $$;
ROLLBACK;
SELECT 'B recipe functions: PASS' AS result;
