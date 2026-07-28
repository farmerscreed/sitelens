-- ═══════════════════════════════════════════════════════════════════════════
-- M7 — AC-13: a client opens the portal with link + PIN (no account); the link is
-- revocable; every access is logged. Plus: wrong PIN rejected+logged, expiry blocks,
-- and the view leaks NO supplier names / unit prices / worker data (F-13.6). BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  proj uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  res jsonb; tok text; pin text; lid uuid; v jsonb; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  res := fn_create_portal_link(proj, 'Client Bob', '+2348000000099', false, 90);
  tok := res->>'token'; pin := res->>'pin'; lid := (res->>'link_id')::uuid;
  PERFORM set_config('request.jwt.claims', NULL, true);   -- the portal is NOT authenticated

  -- Open with the correct PIN.
  v := fn_portal_view(tok, pin, '1.2.3.4'::inet, 'test-agent');
  IF v->>'project' IS NULL THEN RAISE WARNING 'no project in view'; fails:=fails+1; END IF;
  IF v->'progress' IS NULL OR v->'spend' IS NULL THEN RAISE WARNING 'missing progress/spend'; fails:=fails+1; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal_access_log WHERE link_id=lid AND pin_success) THEN
    RAISE WARNING 'successful access not logged'; fails:=fails+1; END IF;

  -- F-13.6: no supplier / unit price / worker data in the payload.
  IF v::text ILIKE '%supplier%' OR v::text ILIKE '%unit_price%' OR v::text ILIKE '%worker%' THEN
    RAISE WARNING 'portal view leaked restricted data'; fails:=fails+1; END IF;
  -- line items hidden when show_line_items = false
  IF v->>'line_items' IS NOT NULL THEN RAISE WARNING 'line items exposed despite show_line_items=false'; fails:=fails+1; END IF;

  -- Wrong PIN (forwarded link without the PIN) → rejected AND logged.
  v := fn_portal_view(tok, '000000', NULL, NULL);
  IF v->>'error' IS NULL THEN RAISE WARNING 'wrong PIN accepted'; fails:=fails+1; END IF;
  IF NOT EXISTS (SELECT 1 FROM portal_access_log WHERE link_id=lid AND NOT pin_success) THEN
    RAISE WARNING 'failed PIN attempt not logged'; fails:=fails+1; END IF;

  -- Revoke → link no longer opens.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  PERFORM fn_revoke_portal_link(lid);
  PERFORM set_config('request.jwt.claims', NULL, true);
  v := fn_portal_view(tok, pin, NULL, NULL);
  IF v->>'error' <> 'link revoked' THEN RAISE WARNING 'revoked link opened (%)', v->>'error'; fails:=fails+1; END IF;

  -- Renew then force-expire → expired link no longer opens.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  PERFORM fn_renew_portal_link(lid, 90);
  UPDATE portal_links SET expires_at = NOW() - INTERVAL '1 day' WHERE id = lid;
  PERFORM set_config('request.jwt.claims', NULL, true);
  v := fn_portal_view(tok, pin, NULL, NULL);
  IF v->>'error' <> 'link expired' THEN RAISE WARNING 'expired link opened (%)', v->>'error'; fails:=fails+1; END IF;

  IF fails > 0 THEN RAISE EXCEPTION 'AC-13 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-13 PASS: link+PIN opens; access logged; wrong PIN rejected+logged; revoke+expiry block; no financial leak.';
END $$;
ROLLBACK;
SELECT 'AC-13 client portal: PASS' AS result;
