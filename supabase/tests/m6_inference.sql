-- ═══════════════════════════════════════════════════════════════════════════
-- M6 — the inference loop (Rule 3): record a proposal, a human accepts/rejects it
-- (the verdict becomes the training label); + pgvector report retrieval. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj uuid := 'a5555555-5555-5555-5555-555555555555';
  rep  uuid := 'a3a3a3a3-0000-0000-0000-0000000000a1';  -- seeded daily report in projA
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  i1 uuid; i2 uuid; n int; fails int := 0; sim double precision;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  -- Record two proposals.
  i1 := fn_record_inference(org_a, 'expense', '{"amount":100000}'::jsonb, p_confidence=>0.92, p_cost_estimate=>0.0004);
  i2 := fn_record_inference(org_a, 'media',   '{"blurry":true}'::jsonb,   p_confidence=>0.7);
  IF (SELECT status FROM ai_inferences WHERE id=i1) <> 'proposed' THEN RAISE WARNING 'not proposed'; fails:=fails+1; END IF;

  -- Human accepts i1 with the corrected truth (training label); rejects i2.
  PERFORM fn_resolve_inference(i1, true, '{"amount":98000}'::jsonb);
  PERFORM fn_resolve_inference(i2, false);
  IF (SELECT status FROM ai_inferences WHERE id=i1) <> 'accepted' THEN RAISE WARNING 'accept failed'; fails:=fails+1; END IF;
  IF (SELECT human_value->>'amount' FROM ai_inferences WHERE id=i1) <> '98000' THEN RAISE WARNING 'training label not stored'; fails:=fails+1; END IF;
  IF (SELECT reviewed_by FROM ai_inferences WHERE id=i1) IS NULL THEN RAISE WARNING 'reviewer not recorded'; fails:=fails+1; END IF;
  IF (SELECT status FROM ai_inferences WHERE id=i2) <> 'rejected' THEN RAISE WARNING 'reject failed'; fails:=fails+1; END IF;

  -- pgvector retrieval: embed the seeded report, then a matching query finds it.
  INSERT INTO report_embeddings (report_id, embedding)
  VALUES (rep, array_fill(0.1::float8, ARRAY[1536])::vector);
  SELECT similarity INTO sim FROM fn_match_reports(proj, array_fill(0.1::float8, ARRAY[1536])::vector, 5) LIMIT 1;
  IF sim IS NULL OR sim < 0.99 THEN RAISE WARNING 'pgvector match similarity=% (exp ~1)', sim; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'inference loop FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'M6 inference loop PASS: propose→accept(label)/reject; pgvector retrieval works.';
END $$;
ROLLBACK;
SELECT 'M6 inference loop + pgvector: PASS' AS result;
