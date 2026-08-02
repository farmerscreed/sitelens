-- ═══════════════════════════════════════════════════════════════════════════
-- Client milestones: stages auto-map to a standardized milestone on insert (trigger);
-- building_milestones derives done/in_progress/not_started from stage completion;
-- a stage's milestone is editable (manager-gated). BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  typ uuid; s_sub uuid; s_frame uuid; s_roof uuid; s_walls uuid; s_wf uuid; s_elec uuid;
  bld uuid; m text; st text; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'MS Type', 'terrace');
  s_sub   := fn_add_type_stage(typ, 'Substructure', 1);
  s_frame := fn_add_type_stage(typ, 'Frame', 2);
  s_roof  := fn_add_type_stage(typ, 'Roof', 3);
  s_walls := fn_add_type_stage(typ, 'Walls', 4);
  s_wf    := fn_add_type_stage(typ, 'Wall Finishings', 5);
  s_elec  := fn_add_type_stage(typ, 'Electrical Installations', 6);

  -- Auto-map on insert (trigger) — precedence puts "Wall Finishings" in Finishes, "Walls" in Walls.
  SELECT milestone INTO m FROM type_stages WHERE id = s_sub;   IF m <> 'Foundation'       THEN RAISE WARNING 'Substructure->% (exp Foundation)', m; fails:=fails+1; END IF;
  SELECT milestone INTO m FROM type_stages WHERE id = s_frame; IF m <> 'Structure'        THEN RAISE WARNING 'Frame->% (exp Structure)', m; fails:=fails+1; END IF;
  SELECT milestone INTO m FROM type_stages WHERE id = s_roof;  IF m <> 'Roofing'          THEN RAISE WARNING 'Roof->% (exp Roofing)', m; fails:=fails+1; END IF;
  SELECT milestone INTO m FROM type_stages WHERE id = s_walls; IF m <> 'Walls & openings' THEN RAISE WARNING 'Walls->% (exp Walls & openings)', m; fails:=fails+1; END IF;
  SELECT milestone INTO m FROM type_stages WHERE id = s_wf;    IF m <> 'Finishes'         THEN RAISE WARNING 'Wall Finishings->% (exp Finishes)', m; fails:=fails+1; END IF;
  SELECT milestone INTO m FROM type_stages WHERE id = s_elec;  IF m <> 'Services'         THEN RAISE WARNING 'Electrical->% (exp Services)', m; fails:=fails+1; END IF;

  -- Stamp a building; complete Substructure → Foundation done, Structure now in progress.
  PERFORM fn_create_buildings(typ, 1, proj, NULL, NULL, 'MS');
  SELECT id INTO bld FROM buildings WHERE project_id=proj AND building_type_id=typ LIMIT 1;
  PERFORM fn_complete_stage(bld, s_sub);
  SELECT status INTO st FROM building_milestones WHERE building_id=bld AND milestone='Foundation';
  IF st <> 'done'        THEN RAISE WARNING 'Foundation status=% (exp done)', st; fails:=fails+1; END IF;
  SELECT status INTO st FROM building_milestones WHERE building_id=bld AND milestone='Structure';
  IF st <> 'in_progress' THEN RAISE WARNING 'Structure status=% (exp in_progress)', st; fails:=fails+1; END IF;
  SELECT status INTO st FROM building_milestones WHERE building_id=bld AND milestone='Roofing';
  IF st <> 'not_started' THEN RAISE WARNING 'Roofing status=% (exp not_started)', st; fails:=fails+1; END IF;

  -- Editable, manager-gated.
  PERFORM fn_set_type_stage_milestone(s_walls, 'Structure');
  SELECT milestone INTO m FROM type_stages WHERE id=s_walls;
  IF m <> 'Structure' THEN RAISE WARNING 'set milestone failed (%)', m; fails:=fails+1; END IF;
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN PERFORM fn_set_type_stage_milestone(s_roof, 'Finishes');
    RAISE WARNING 'cross-org set a milestone'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'MILESTONES FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'MILESTONES PASS: stages auto-map to milestones (trigger); building_milestones done/in_progress/not_started; edit + authz.';
END $$;
ROLLBACK;
SELECT 'Milestones: PASS' AS result;
