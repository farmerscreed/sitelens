-- ═══════════════════════════════════════════════════════════════════════════
-- M6 — AC-3: a resubmitted old photo is flagged as a duplicate automatically.
-- Near-duplicate by Hamming distance (≤ 8 of 64 bits) within a 90-day window.
-- BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
INSERT INTO projects (id, org_id, name, created_by)
VALUES ('caa00000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000aa',
        'AC3 window', 'a1111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj uuid := 'a5555555-5555-5555-5555-555555555555';
  pw   uuid := 'caa00000-0000-0000-0000-0000000000c1';
  mem  uuid := 'a3333333-3333-3333-3333-333333333333';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); c uuid := gen_random_uuid();
  old_id uuid := gen_random_uuid(); nu uuid := gen_random_uuid(); nu2 uuid := gen_random_uuid();
  fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Original.
  PERFORM fn_register_media(a, org_a, proj, 'x','x','x', p_phash=>x'FF00FF00FF00FF00'::bit(64));
  -- Near-duplicate (3 bits differ) → flagged as duplicate of the original.
  PERFORM fn_register_media(b, org_a, proj, 'x','x','x', p_phash=>x'FF00FF00FF00FF07'::bit(64));
  IF (SELECT duplicate_of FROM media WHERE id=b) <> a THEN RAISE WARNING 'near-dup not flagged'; fails:=fails+1; END IF;
  -- Far photo (64 bits differ) → NOT flagged.
  PERFORM fn_register_media(c, org_a, proj, 'x','x','x', p_phash=>x'00FF00FF00FF00FF'::bit(64));
  IF (SELECT duplicate_of FROM media WHERE id=c) IS NOT NULL THEN RAISE WARNING 'far photo wrongly flagged'; fails:=fails+1; END IF;

  -- Window: a 100-day-old photo with the same hash must NOT match a new one.
  INSERT INTO media (id, org_id, project_id, key_thumb, key_display, key_original, phash, received_at, uploaded_by)
  VALUES (old_id, org_a, pw, 'x','x','x', x'ABCDABCDABCDABCD'::bit(64), NOW() - INTERVAL '100 days', mem);
  PERFORM fn_register_media(nu, org_a, pw, 'x','x','x', p_phash=>x'ABCDABCDABCDABCD'::bit(64));
  IF (SELECT duplicate_of FROM media WHERE id=nu) IS NOT NULL THEN RAISE WARNING 'matched a photo outside the 90-day window'; fails:=fails+1; END IF;

  -- ...but a RESUBMIT within the window IS flagged (AC-3 core).
  PERFORM fn_register_media(nu2, org_a, pw, 'x','x','x', p_phash=>x'ABCDABCDABCDABCD'::bit(64));
  IF (SELECT duplicate_of FROM media WHERE id=nu2) <> nu THEN RAISE WARNING 'resubmitted photo not flagged'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'AC-3 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-3 PASS: near-dup flagged; far not; outside-90d not; resubmit flagged.';
END $$;
ROLLBACK;
SELECT 'AC-3 duplicate photo: PASS' AS result;
