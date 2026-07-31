-- ═══════════════════════════════════════════════════════════════════════════
-- Archive (soft-delete) for buildings and recipes:
--   • archived building leaves board_view; its (project,code) frees up so the
--     code can be re-stamped; archive is idempotent; unarchive restores it, but
--     is blocked when a live building already holds the code.
--   • archived recipe leaves the library; blocked while a live building uses it,
--     allowed once none do; unarchive restores.
--   • manager-gated (engineer blocked); org-isolated (can't touch another org).
-- Runs in BEGIN/ROLLBACK against the seeded DB.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/archive.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- An engineer (non-manager) in Org A.
INSERT INTO app_users (id, full_name, phone)
VALUES ('e5555555-5555-5555-5555-555555555555', 'Eng Arch', '+2348000000055');
INSERT INTO memberships (id, org_id, user_id, role)
VALUES ('e6666666-6666-6666-6666-666666666666',
        'a0000000-0000-0000-0000-0000000000aa',
        'e5555555-5555-5555-5555-555555555555', 'engineer');

DO $$
DECLARE
  org_a  uuid := 'a0000000-0000-0000-0000-0000000000aa';
  org_b  uuid := 'b0000000-0000-0000-0000-0000000000bb';
  proj_a uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';  -- admin of A
  eng    uuid := 'e5555555-5555-5555-5555-555555555555';   -- engineer in A
  bld_a  uuid := 'aabb0000-0000-0000-0000-0000000000a1';   -- seed building 'A-01', type A
  bld_b  uuid := 'aabb0000-0000-0000-0000-0000000000b1';   -- seed building in org B
  type_a uuid := 'aaaa0000-0000-0000-0000-0000000000a1';   -- seed recipe (org A)
  type_b uuid := 'bbbb0000-0000-0000-0000-0000000000b1';   -- seed recipe (org B)
  new_bld uuid := 'ccccdddd-0000-0000-0000-0000000000c1';
  n int; ts1 timestamptz; ts2 timestamptz; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- ── building archive hides it from the board ──
  PERFORM fn_archive_building(bld_a);
  SELECT count(*) INTO n FROM board_view WHERE id = bld_a;
  IF n <> 0 THEN RAISE WARNING 'archived building still on board (%)', n; fails:=fails+1; END IF;
  SELECT archived_at INTO ts1 FROM buildings WHERE id = bld_a;
  IF ts1 IS NULL THEN RAISE WARNING 'archived_at not set'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM buildings WHERE id = bld_a AND archived_by IS NOT NULL;
  IF n <> 1 THEN RAISE WARNING 'archived_by not recorded'; fails:=fails+1; END IF;

  -- idempotent: second archive keeps the FIRST timestamp
  PERFORM fn_archive_building(bld_a);
  SELECT archived_at INTO ts2 FROM buildings WHERE id = bld_a;
  IF ts1 <> ts2 THEN RAISE WARNING 'archive not idempotent (% vs %)', ts1, ts2; fails:=fails+1; END IF;

  -- ── unarchive restores it ──
  PERFORM fn_unarchive_building(bld_a);
  SELECT count(*) INTO n FROM board_view WHERE id = bld_a;
  IF n <> 1 THEN RAISE WARNING 'unarchived building not back on board (%)', n; fails:=fails+1; END IF;

  -- re-archive, then prove the CODE is freed for a fresh live building
  PERFORM fn_archive_building(bld_a);
  INSERT INTO buildings (id, org_id, project_id, building_type_id, code)
  VALUES (new_bld, org_a, proj_a, type_a, 'A-01');   -- same code, now allowed
  SELECT count(*) INTO n FROM board_view WHERE id = new_bld;
  IF n <> 1 THEN RAISE WARNING 'fresh live A-01 not created after code freed (%)', n; fails:=fails+1; END IF;

  -- the partial unique index still forbids TWO live buildings with one code
  BEGIN
    INSERT INTO buildings (id, org_id, project_id, building_type_id, code)
    VALUES (gen_random_uuid(), org_a, proj_a, type_a, 'A-01');
    RAISE WARNING 'two live A-01 buildings allowed'; fails:=fails+1;
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- unarchive is blocked while a live building now holds that code
  BEGIN
    PERFORM fn_unarchive_building(bld_a);
    RAISE WARNING 'unarchive succeeded despite live code clash'; fails:=fails+1;
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- ── recipe archive: blocked while a live building uses it ──
  BEGIN
    PERFORM fn_archive_building_type(type_a);
    RAISE WARNING 'archived a recipe with a live building'; fails:=fails+1;
  EXCEPTION WHEN raise_exception THEN NULL; END;

  -- archive the last live building on the recipe, then the recipe archives cleanly
  PERFORM fn_archive_building(new_bld);
  PERFORM fn_archive_building_type(type_a);
  SELECT count(*) INTO n FROM building_types WHERE id = type_a AND archived_at IS NOT NULL;
  IF n <> 1 THEN RAISE WARNING 'recipe archived_at not set'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM building_types WHERE org_id = org_a AND id = type_a AND archived_at IS NULL;
  IF n <> 0 THEN RAISE WARNING 'archived recipe still visible in live filter'; fails:=fails+1; END IF;

  -- unarchive the recipe restores it to the library
  PERFORM fn_unarchive_building_type(type_a);
  SELECT count(*) INTO n FROM building_types WHERE id = type_a AND archived_at IS NULL;
  IF n <> 1 THEN RAISE WARNING 'recipe not restored by unarchive'; fails:=fails+1; END IF;

  -- ── authz: an engineer cannot archive anything ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng)::text, true);
  BEGIN PERFORM fn_archive_building(bld_a);
    RAISE WARNING 'engineer archived a building'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_archive_building_type(type_a);
    RAISE WARNING 'engineer archived a recipe'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- ── org isolation: Org A manager cannot archive Org B's rows ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  BEGIN PERFORM fn_archive_building(bld_b);
    RAISE WARNING 'Org A archived an Org B building'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_archive_building_type(type_b);
    RAISE WARNING 'Org A archived an Org B recipe'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'ARCHIVE FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'ARCHIVE PASS: building leaves board + frees code (idempotent, reversible, code-clash guarded); recipe archive blocked while in use then clean; engineer blocked; org-isolated.';
END $$;
ROLLBACK;
SELECT 'Archive: PASS' AS result;
