-- ═══════════════════════════════════════════════════════════════════════════
-- M2 gate — "58 buildings stamped from 2 types; the board shows each at its
-- stage." Also: stage progress seeding, board columns, version stamping, batch
-- advance + cost, authz, and a 300-building scale sanity. Runs in BEGIN/ROLLBACK.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/m2_buildings_board.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Fresh project so seed data doesn't skew counts.
INSERT INTO projects (id, org_id, name, created_by)
VALUES ('c0000000-0000-0000-0000-0000000000c1',
        'a0000000-0000-0000-0000-0000000000aa', 'M2 Test Estate',
        'a1111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'c0000000-0000-0000-0000-0000000000c1';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  eng    uuid := 'e1111111-1111-1111-1111-111111111111';
  tA uuid; tB uuid; tA2 uuid; ph uuid; ba uuid; ba2 uuid;
  fnd uuid; b uuid; n int; fails int := 0; c numeric;
  proj300 uuid := 'c0000000-0000-0000-0000-00000000c300';
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Two types, each with 5 stages. Give type A a stage cost so batch cost > 0.
  tA := fn_create_building_type(org_a, 'M2 Type A', 'terrace');
  tB := fn_create_building_type(org_a, 'M2 Type B', 'duplex');
  fnd := fn_add_type_stage(tA, 'Foundation', 1);
  PERFORM fn_add_type_stage(tA, 'DPC', 2);
  PERFORM fn_add_type_stage(tA, 'Lintel', 3);
  PERFORM fn_add_type_stage(tA, 'Roof', 4);
  PERFORM fn_add_type_stage(tA, 'Finishes', 5);
  PERFORM fn_set_type_stage_cost(tA, fnd, 'labour', 100000);
  PERFORM fn_add_type_stage(tB, 'Foundation', 1);
  PERFORM fn_add_type_stage(tB, 'DPC', 2);
  PERFORM fn_add_type_stage(tB, 'Lintel', 3);
  PERFORM fn_add_type_stage(tB, 'Roof', 4);
  PERFORM fn_add_type_stage(tB, 'Finishes', 5);

  ph := fn_create_phase(proj, 'Phase 1', 1);
  ba := fn_create_batch(proj, 'Batch 1', ph, 1);

  -- ── stamp 40 × A + 18 × B = 58 ──
  PERFORM fn_create_buildings(tA, 40, proj, ba, ph, 'A');
  PERFORM fn_create_buildings(tB, 18, proj, ba, ph, 'B');

  SELECT count(*) INTO n FROM buildings WHERE project_id = proj;
  IF n <> 58 THEN RAISE WARNING 'expected 58 buildings, got %', n; fails:=fails+1; END IF;

  -- stage progress seeded: 40×5 + 18×5 = 290 rows
  SELECT count(*) INTO n FROM building_stage_progress p JOIN buildings b2 ON b2.id=p.building_id WHERE b2.project_id=proj;
  IF n <> 290 THEN RAISE WARNING 'expected 290 stage-progress rows, got %', n; fails:=fails+1; END IF;

  -- every building starts at its first stage, not_started
  SELECT count(*) INTO n FROM buildings WHERE project_id=proj AND (current_stage_id IS NULL OR status <> 'not_started');
  IF n <> 0 THEN RAISE WARNING '% buildings not initialised to first stage/not_started', n; fails:=fails+1; END IF;

  -- board: all 58 in "Not started" initially
  SELECT count(*) INTO n FROM board_view WHERE project_id=proj AND board_column='Not started';
  IF n <> 58 THEN RAISE WARNING 'expected 58 in Not started, got %', n; fails:=fails+1; END IF;

  -- ── advance some buildings so the board spreads across columns ──
  -- Building A002: complete Foundation → sits at DPC.
  SELECT id INTO b FROM buildings WHERE project_id=proj AND code='A002';
  PERFORM fn_complete_stage(b, fnd);
  IF (SELECT board_column FROM board_view WHERE id=b) <> 'DPC' THEN
    RAISE WARNING 'A002 board_column=% (expected DPC)', (SELECT board_column FROM board_view WHERE id=b); fails:=fails+1; END IF;

  -- Building A003: complete Foundation + DPC → sits at Lintel.
  SELECT id INTO b FROM buildings WHERE project_id=proj AND code='A003';
  PERFORM fn_complete_stage(b, fnd);
  PERFORM fn_complete_stage(b, (SELECT id FROM type_stages WHERE building_type_id=tA AND name='DPC'));
  IF (SELECT board_column FROM board_view WHERE id=b) <> 'Lintel' THEN
    RAISE WARNING 'A003 board_column=% (expected Lintel)', (SELECT board_column FROM board_view WHERE id=b); fails:=fails+1; END IF;

  -- Building A004: complete all 5 → Done.
  SELECT id INTO b FROM buildings WHERE project_id=proj AND code='A004';
  PERFORM fn_complete_stage(b, fnd);
  PERFORM fn_complete_stage(b, (SELECT id FROM type_stages WHERE building_type_id=tA AND name='DPC'));
  PERFORM fn_complete_stage(b, (SELECT id FROM type_stages WHERE building_type_id=tA AND name='Lintel'));
  PERFORM fn_complete_stage(b, (SELECT id FROM type_stages WHERE building_type_id=tA AND name='Roof'));
  PERFORM fn_complete_stage(b, (SELECT id FROM type_stages WHERE building_type_id=tA AND name='Finishes'));
  IF (SELECT board_column FROM board_view WHERE id=b) <> 'Done' THEN
    RAISE WARNING 'A004 not Done'; fails:=fails+1; END IF;
  IF (SELECT status FROM buildings WHERE id=b) <> 'done' THEN RAISE WARNING 'A004 status not done'; fails:=fails+1; END IF;

  -- board now spread across >= 4 distinct columns
  SELECT count(DISTINCT board_column) INTO n FROM board_view WHERE project_id=proj;
  IF n < 4 THEN RAISE WARNING 'board only spread across % columns', n; fails:=fails+1; END IF;

  -- ── version stamping: existing buildings keep their version ──
  tA2 := fn_new_type_version(tA);   -- new version row
  SELECT count(*) INTO n FROM buildings WHERE project_id=proj AND building_type_id=tA;  -- still v1
  IF n <> 40 THEN RAISE WARNING 'existing buildings drifted off their version (%)', n; fails:=fails+1; END IF;
  PERFORM fn_create_buildings(tA2, 2, proj, NULL, ph, 'AV2');  -- new buildings on v2
  IF (SELECT count(*) FROM buildings WHERE project_id=proj AND building_type_id=tA2) <> 2 THEN
    RAISE WARNING 'v2 buildings not stamped on the new version'; fails:=fails+1; END IF;

  -- ── batch advance + cost ──
  PERFORM fn_advance_batch(ba);
  IF (SELECT status FROM batches WHERE id=ba) <> 'active' THEN RAISE WARNING 'batch not active'; fails:=fails+1; END IF;
  c := fn_batch_cost(ba);   -- 40 × 100000 (type A stage cost) + 18 × 0
  IF c <> 4000000 THEN RAISE WARNING 'batch cost=% (expected 4000000)', c; fails:=fails+1; END IF;

  -- ── authz: an engineer cannot stamp / complete / advance ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng)::text, true);
  BEGIN PERFORM fn_create_buildings(tA, 1, proj, ba, ph, 'X');
    RAISE WARNING 'engineer stamped a building'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_advance_batch(ba);
    RAISE WARNING 'engineer advanced a batch'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_complete_stage((SELECT id FROM buildings WHERE project_id=proj AND code='A005'), fnd);
    RAISE WARNING 'engineer completed a stage'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- ── 300-building scale sanity ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  INSERT INTO projects (id, org_id, name, created_by) VALUES (proj300, org_a, 'Scale 300', user_a);
  PERFORM fn_create_buildings(tA, 300, proj300, NULL, NULL, 'S');
  SELECT count(*) INTO n FROM board_view WHERE project_id = proj300;
  IF n <> 300 THEN RAISE WARNING '300-scale: board returned % rows', n; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'M2 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'M2 PASS: 58 buildings stamped from 2 types; board spread across stages; version-stamped; batch advance+cost; authz; 300-scale ok.';
END $$;
ROLLBACK;
SELECT 'M2 buildings + board: PASS' AS result;
