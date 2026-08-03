-- ═══════════════════════════════════════════════════════════════════════════
-- Phase D: photos are addressable per building. fn_register_media(p_building)
-- stamps media.building_id (validated against the project; wrong-project
-- building rejected); registration stays idempotent; an engineer can register.
-- BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
INSERT INTO app_users (id, full_name, phone)
VALUES ('e1111111-1111-1111-1111-111111111111', 'Eng A', '+2348000000009')
ON CONFLICT (id) DO NOTHING;
INSERT INTO memberships (id, org_id, user_id, role)
VALUES ('e2222222-2222-2222-2222-222222222222',
        'a0000000-0000-0000-0000-0000000000aa',
        'e1111111-1111-1111-1111-111111111111', 'engineer')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  eng   uuid := 'e1111111-1111-1111-1111-111111111111';
  typ uuid; bld uuid; mid uuid := gen_random_uuid();
  v uuid; n int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Gallery Type', 'terrace');
  PERFORM fn_add_type_stage(typ, 'Substructure', 1);
  PERFORM fn_create_buildings(typ, 1, proj, NULL, NULL, 'GAL');
  SELECT id INTO bld FROM buildings WHERE project_id=proj AND building_type_id=typ LIMIT 1;

  -- Engineer registers a building-tagged photo.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng)::text, true);
  PERFORM fn_register_media(p_id=>mid, p_org=>org_a, p_project=>proj,
    p_key_thumb=>'k/t.jpg', p_key_display=>'k/d.jpg', p_key_original=>'k/o.jpg',
    p_building=>bld);
  SELECT building_id INTO v FROM media WHERE id = mid;
  IF v <> bld THEN RAISE WARNING 'media.building_id=% (exp %)', v, bld; fails:=fails+1; END IF;

  -- Idempotent: same id re-registered → still one row.
  PERFORM fn_register_media(p_id=>mid, p_org=>org_a, p_project=>proj,
    p_key_thumb=>'k/t.jpg', p_key_display=>'k/d.jpg', p_key_original=>'k/o.jpg',
    p_building=>bld);
  SELECT count(*) INTO n FROM media WHERE id = mid;
  IF n <> 1 THEN RAISE WARNING 'retry duplicated media (%)', n; fails:=fails+1; END IF;

  -- A building from another project is rejected.
  BEGIN
    PERFORM fn_register_media(p_id=>gen_random_uuid(), p_org=>org_a,
      p_project=>'b6666666-6666-6666-6666-666666666666',
      p_key_thumb=>'x', p_key_display=>'x', p_key_original=>'x', p_building=>bld);
    RAISE WARNING 'foreign-project building accepted'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'MEDIA BUILDING FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'MEDIA BUILDING PASS: building-tagged register; validated; idempotent; engineer allowed.';
END $$;
ROLLBACK;
SELECT 'Media per building: PASS' AS result;
