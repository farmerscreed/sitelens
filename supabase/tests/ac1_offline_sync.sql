-- ═══════════════════════════════════════════════════════════════════════════
-- M4 gate — AC-1: an engineer submits a complete daily report fully offline; it
-- syncs with NO DUPLICATES and no loss. Simulated at the sync-protocol layer: a
-- client-generated id + idempotency_key, then a RETRY with the same key (lost ack)
-- must create nothing new. Also: amendment→new version, geofence/backdate flags,
-- media idempotency + duplicate flag, authz. Runs in BEGIN/ROLLBACK.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/ac1_offline_sync.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- Give Estate A (seed project) a geofence.
UPDATE projects SET centroid = ST_SetSRID(ST_MakePoint(3.4, 6.5), 4326)::geography,
                    geofence_radius_m = 150
 WHERE id = 'a5555555-5555-5555-5555-555555555555';

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  m_in  uuid := 'd1000000-0000-0000-0000-0000000000d1';
  m_out uuid := 'd2000000-0000-0000-0000-0000000000d2';
  m_h1  uuid := 'd3000000-0000-0000-0000-0000000000d3';
  m_h2  uuid := 'd4000000-0000-0000-0000-0000000000d4';
  rep   uuid := 'e1000000-0000-0000-0000-0000000000e1';  -- client-generated UUIDv7 (simulated)
  rep2  uuid := 'e2000000-0000-0000-0000-0000000000e2';
  ret uuid; n int; fails int := 0;
BEGIN
  -- The seed ships one daily report for Estate A today; clear it so counts are clean.
  DELETE FROM daily_reports WHERE project_id = proj AND report_date = CURRENT_DATE;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Register two photos: one inside the fence, one far outside.
  PERFORM fn_register_media(p_id=>m_in,  p_org=>org_a, p_project=>proj,
    p_key_thumb=>'a/t1', p_key_display=>'a/d1', p_key_original=>'a/o1',
    p_lon=>3.4001, p_lat=>6.5001);
  PERFORM fn_register_media(p_id=>m_out, p_org=>org_a, p_project=>proj,
    p_key_thumb=>'a/t2', p_key_display=>'a/d2', p_key_original=>'a/o2',
    p_lon=>3.5, p_lat=>6.6);
  IF (SELECT within_geofence FROM media WHERE id=m_in) IS NOT TRUE THEN RAISE WARNING 'in-fence photo not flagged inside'; fails:=fails+1; END IF;
  IF (SELECT within_geofence FROM media WHERE id=m_out) IS NOT FALSE THEN RAISE WARNING 'out-fence photo not flagged outside'; fails:=fails+1; END IF;

  -- Media registration is idempotent (retry the same id → no duplicate).
  PERFORM fn_register_media(p_id=>m_in, p_org=>org_a, p_project=>proj,
    p_key_thumb=>'a/t1', p_key_display=>'a/d1', p_key_original=>'a/o1', p_lon=>3.4001, p_lat=>6.5001);
  SELECT count(*) INTO n FROM media WHERE id=m_in;
  IF n <> 1 THEN RAISE WARNING 'media retry duplicated (n=%)', n; fails:=fails+1; END IF;

  -- basic exact-phash duplicate flag (AI-1 seam)
  PERFORM fn_register_media(p_id=>m_h1, p_org=>org_a, p_project=>proj,
    p_key_thumb=>'a/t3', p_key_display=>'a/d3', p_key_original=>'a/o3', p_phash=>x'FF00FF00FF00FF00'::bit(64));
  PERFORM fn_register_media(p_id=>m_h2, p_org=>org_a, p_project=>proj,
    p_key_thumb=>'a/t4', p_key_display=>'a/d4', p_key_original=>'a/o4', p_phash=>x'FF00FF00FF00FF00'::bit(64));
  IF (SELECT duplicate_of FROM media WHERE id=m_h2) <> m_h1 THEN RAISE WARNING 'exact-phash duplicate not flagged'; fails:=fails+1; END IF;

  -- ── Submit the report OFFLINE ──
  ret := fn_submit_daily_report(p_id=>rep, p_project=>proj, p_report_date=>CURRENT_DATE,
    p_work_summary=>'Poured foundation', p_idempotency_key=>'idem-1',
    p_is_offline=>true, p_media=>ARRAY[m_in, m_out]);
  IF ret <> rep THEN RAISE WARNING 'submit returned wrong id'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM daily_reports WHERE project_id=proj AND report_date=CURRENT_DATE;
  IF n <> 1 THEN RAISE WARNING 'expected 1 report, got %', n; fails:=fails+1; END IF;
  IF (SELECT version FROM daily_reports WHERE id=rep) <> 1 THEN RAISE WARNING 'first version not 1'; fails:=fails+1; END IF;
  IF (SELECT is_offline_submission FROM daily_reports WHERE id=rep) IS NOT TRUE THEN RAISE WARNING 'offline flag lost'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM daily_report_media WHERE report_id=rep;
  IF n <> 2 THEN RAISE WARNING 'expected 2 media links, got %', n; fails:=fails+1; END IF;

  -- ── THE RETRY (lost ack over 3G): SAME idempotency_key → no-op ──
  ret := fn_submit_daily_report(p_id=>rep, p_project=>proj, p_report_date=>CURRENT_DATE,
    p_work_summary=>'Poured foundation', p_idempotency_key=>'idem-1',
    p_is_offline=>true, p_media=>ARRAY[m_in, m_out]);
  IF ret <> rep THEN RAISE WARNING 'retry returned a different id'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM daily_reports WHERE project_id=proj AND report_date=CURRENT_DATE;
  IF n <> 1 THEN RAISE WARNING 'RETRY DUPLICATED the report (n=%)', n; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM daily_report_media WHERE report_id=rep;
  IF n <> 2 THEN RAISE WARNING 'retry duplicated media links (n=%)', n; fails:=fails+1; END IF;

  -- ── Amendment: same date, new idempotency_key → new version ──
  PERFORM fn_submit_daily_report(p_id=>rep2, p_project=>proj, p_report_date=>CURRENT_DATE,
    p_work_summary=>'Amended: also DPC', p_idempotency_key=>'idem-2');
  SELECT count(*) INTO n FROM daily_reports WHERE project_id=proj AND report_date=CURRENT_DATE;
  IF n <> 2 THEN RAISE WARNING 'amendment did not create v2 (n=%)', n; fails:=fails+1; END IF;
  IF (SELECT version FROM daily_reports WHERE id=rep2) <> 2 THEN RAISE WARNING 'amendment version not 2'; fails:=fails+1; END IF;

  -- Backdating > 3 days rejected; future rejected.
  BEGIN
    PERFORM fn_submit_daily_report(p_id=>gen_random_uuid(), p_project=>proj,
      p_report_date=>CURRENT_DATE - 5, p_work_summary=>'old', p_idempotency_key=>'idem-old');
    RAISE WARNING 'backdate > 3 days accepted'; fails:=fails+1;
  EXCEPTION WHEN others THEN NULL; END;
  BEGIN
    PERFORM fn_submit_daily_report(p_id=>gen_random_uuid(), p_project=>proj,
      p_report_date=>CURRENT_DATE + 1, p_work_summary=>'future', p_idempotency_key=>'idem-fut');
    RAISE WARNING 'future date accepted'; fails:=fails+1;
  EXCEPTION WHEN others THEN NULL; END;

  -- Authz: a non-member (org B admin) cannot submit or register media to org A.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN
    PERFORM fn_submit_daily_report(p_id=>gen_random_uuid(), p_project=>proj,
      p_report_date=>CURRENT_DATE, p_work_summary=>'x', p_idempotency_key=>'idem-b');
    RAISE WARNING 'non-member submitted a report'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM fn_register_media(p_id=>gen_random_uuid(), p_org=>org_a, p_project=>proj,
      p_key_thumb=>'x', p_key_display=>'x', p_key_original=>'x');
    RAISE WARNING 'non-member registered media'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'AC-1 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-1 PASS: offline report syncs; retry (same idempotency_key) creates NO duplicate; amendment versions; geofence/backdate/phash/authz hold.';
END $$;
ROLLBACK;
SELECT 'AC-1 offline daily-report sync: PASS' AS result;
