-- ═══════════════════════════════════════════════════════════════════════════
-- Recipe cover photo: fn_set_type_cover sets/clears, refuses a key outside the
-- org's own prefix, and refuses a caller from another org.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/type_cover.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  typ uuid; t text; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Cover Type', 'g+3');

  PERFORM fn_set_type_cover(typ, org_a::text || '/11111111-1111-1111-1111-111111111111.jpg');
  SELECT cover_key INTO t FROM building_types WHERE id = typ;
  IF t IS NULL THEN RAISE WARNING 'cover not set'; fails:=fails+1; END IF;

  BEGIN
    PERFORM fn_set_type_cover(typ, 'b0000000-0000-0000-0000-0000000000bb/sneaky.jpg');
    RAISE WARNING 'foreign-prefix key accepted'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM fn_set_type_cover(typ, NULL);
  SELECT cover_key INTO t FROM building_types WHERE id = typ;
  IF t IS NOT NULL THEN RAISE WARNING 'cover not cleared'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_set_type_cover(typ, NULL);
    RAISE WARNING 'org B set org A''s cover'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'TYPE COVER FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'Type cover PASS: set/clear; org-prefix guard; cross-org gate.';
END $$;
ROLLBACK;
SELECT 'Type cover: PASS' AS result;
