-- ═══════════════════════════════════════════════════════════════════════════
-- Building-tagged expenses hit the right money card (pilot Area 3):
--   a building-tagged, APPROVED expense lands on that building's spent/forecast;
--   an untagged (whole-project) expense does NOT; a void reverses it; and an
--   expense can't be tagged to a building in another project. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';   -- admin of A
  bl    uuid := 'a9999999-9999-9999-9999-999999999999';    -- seed budget line on proj
  foreign_bld uuid := 'aabb0000-0000-0000-0000-0000000000b1'; -- org B building (seed)
  typ uuid; bld uuid; e1 uuid; e2 uuid; q numeric; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Exp Type', 'terrace');
  PERFORM fn_create_buildings(typ, 1, proj, NULL, NULL, 'EX');
  SELECT id INTO bld FROM buildings WHERE project_id=proj AND building_type_id=typ LIMIT 1;

  -- Building-tagged expense, approved → hits THIS building's money card.
  e1 := gen_random_uuid();
  PERFORM fn_create_expense(e1, proj, bl, 50000, 'idem-eb-1', 'labour', NULL, NULL, NULL, bld, NULL);
  PERFORM fn_approve_expense(e1);
  SELECT spent INTO q FROM building_money WHERE building_id = bld;
  IF q <> 50000 THEN RAISE WARNING 'building spent=% (exp 50000)', q; fails:=fails+1; END IF;

  -- Untagged (whole-project) expense does NOT leak onto the building.
  e2 := gen_random_uuid();
  PERFORM fn_create_expense(e2, proj, bl, 30000, 'idem-eb-2', 'general', NULL, NULL, NULL, NULL, NULL);
  PERFORM fn_approve_expense(e2);
  SELECT spent INTO q FROM building_money WHERE building_id = bld;
  IF q <> 50000 THEN RAISE WARNING 'untagged expense leaked onto building (spent=%)', q; fails:=fails+1; END IF;

  -- Void reverses on the building card.
  PERFORM fn_void_expense(e1, 'test void');
  SELECT spent INTO q FROM building_money WHERE building_id = bld;
  IF q <> 0 THEN RAISE WARNING 'void did not reverse building spent (=%)', q; fails:=fails+1; END IF;

  -- Cross-project guard: cannot tag a building from another project.
  BEGIN
    PERFORM fn_create_expense(gen_random_uuid(), proj, bl, 1000, 'idem-eb-x', NULL, NULL, NULL, NULL, foreign_bld, NULL);
    RAISE WARNING 'expense tagged a foreign building'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'EXPENSE-BUILDING FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'EXPENSE-BUILDING PASS: building-tagged approved expense lands on the money card; untagged does not; void reverses; foreign building rejected.';
END $$;
ROLLBACK;
SELECT 'Expense on building: PASS' AS result;
