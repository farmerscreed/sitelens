-- ═══════════════════════════════════════════════════════════════════════════
-- Client hub (DECISIONS #64): get-or-create dedup on email; sale links to a
-- client; client_summary rolls up contract/paid/outstanding + derived kind +
-- due_now/next-due across ≥2 sales; back-link fn; archive blocked while money
-- is owed; authz (cross-org blocked); RLS org-isolation. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  typ uuid; bld uuid; cli uuid; cli2 uuid; ghost uuid; s1 uuid; s2 uuid; s3 uuid;
  q numeric; t text; b boolean; n int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Hub Type', 'terrace');
  PERFORM fn_add_type_stage(typ, 'Substructure', 1);
  PERFORM fn_create_buildings(typ, 1, proj, NULL, NULL, 'HUB');
  SELECT id INTO bld FROM buildings WHERE project_id = proj AND building_type_id = typ LIMIT 1;

  -- Create + get-or-create dedup: same email returns the SAME client, no dup.
  cli := fn_create_client(org_a, 'Ada Buyer', 'ada@example.com', '0801');
  cli2 := fn_create_client(org_a, 'Ada B.', 'ADA@Example.com');
  IF cli2 <> cli THEN RAISE WARNING 'email dedup created a duplicate'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM clients WHERE org_id=org_a AND email='ada@example.com' AND archived_at IS NULL;
  IF n <> 1 THEN RAISE WARNING 'clients on ada@=% (exp 1)', n; fails:=fails+1; END IF;

  -- Sale created THROUGH the client (buyer, 10m milestone) + a second sale for
  -- the same client (partner, 100m time-phased) → kind derives to 'both'.
  s1 := fn_create_sale(org_a, proj, bld, 'Ada Buyer', 'buyer', 10000000, 'milestone', p_client => cli);
  s2 := fn_create_sale(org_a, proj, NULL, 'Ada Buyer', 'partner', 100000000, 'time_phased', p_client => cli);
  SELECT sale_count INTO n FROM client_summary WHERE client_id = cli;
  IF n <> 2 THEN RAISE WARNING 'sale_count=% (exp 2)', n; fails:=fails+1; END IF;
  SELECT kind INTO t FROM client_summary WHERE client_id = cli;
  IF t <> 'both' THEN RAISE WARNING 'kind=% (exp both)', t; fails:=fails+1; END IF;
  SELECT contract_value INTO q FROM client_summary WHERE client_id = cli;
  IF q <> 110000000 THEN RAISE WARNING 'contract=% (exp 110000000)', q; fails:=fails+1; END IF;

  -- Collections: booking 20% (2m) + partner initial 30% (30m) are due now.
  SELECT due_now, overdue INTO q, b FROM client_summary WHERE client_id = cli;
  IF q <> 32000000 THEN RAISE WARNING 'due_now=% (exp 32000000)', q; fails:=fails+1; END IF;
  IF NOT b THEN RAISE WARNING 'overdue not flagged'; fails:=fails+1; END IF;

  -- Pay the booking in full → due_now drops to the partner initial; next due = Initial.
  PERFORM fn_record_payment(gen_random_uuid(), s1, 2000000, 'hub-pay-1');
  SELECT due_now INTO q FROM client_summary WHERE client_id = cli;
  IF q <> 30000000 THEN RAISE WARNING 'due_now after pay=% (exp 30000000)', q; fails:=fails+1; END IF;
  SELECT next_due_label INTO t FROM client_summary WHERE client_id = cli;
  IF t <> 'Initial' THEN RAISE WARNING 'next_due_label=% (exp Initial)', t; fails:=fails+1; END IF;
  SELECT paid INTO q FROM client_summary WHERE client_id = cli;
  IF q <> 2000000 THEN RAISE WARNING 'paid=% (exp 2000000)', q; fails:=fails+1; END IF;

  -- Back-link: a pre-hub sale (no client) linked afterwards rolls into the summary.
  s3 := fn_create_sale(org_a, proj, bld, 'Ada Buyer', 'buyer', 5000000, 'milestone');
  PERFORM fn_link_sale_client(s3, cli);
  SELECT sale_count, contract_value INTO n, q FROM client_summary WHERE client_id = cli;
  IF n <> 3 OR q <> 115000000 THEN RAISE WARNING 'after link count=%/contract=% (exp 3/115000000)', n, q; fails:=fails+1; END IF;

  -- Archive: blocked while money is owed…
  BEGIN PERFORM fn_archive_client(cli);
    RAISE WARNING 'archived a client who still owes'; fails:=fails+1;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  -- …but a clean client archives and disappears from the directory.
  ghost := fn_create_client(org_a, 'No Sales Yet');
  PERFORM fn_archive_client(ghost);
  SELECT count(*) INTO n FROM client_summary WHERE client_id = ghost;
  IF n <> 0 THEN RAISE WARNING 'archived client still in summary'; fails:=fails+1; END IF;

  -- Authz: cross-org manager fns are blocked.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN PERFORM fn_create_client(org_a, 'Intruder');
    RAISE WARNING 'cross-org created a client'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_update_client(cli, 'Hacked');
    RAISE WARNING 'cross-org updated a client'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'CLIENTS FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'CLIENTS PASS: email dedup; sale→client link; rollup + derived kind; due_now/next-due; back-link; archive guard; authz.';
END $$;

-- RLS org-isolation: as org B (authenticated role), no org-A client is visible.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"b2222222-2222-2222-2222-222222222222","active_org_id":"b0000000-0000-0000-0000-0000000000bb"}', true);
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM clients;
  IF n <> 0 THEN RAISE EXCEPTION 'CLIENTS RLS LEAK: org B sees % org-A client(s)', n; END IF;
  SELECT count(*) INTO n FROM client_summary;
  IF n <> 0 THEN RAISE EXCEPTION 'CLIENTS RLS LEAK: org B sees % client_summary row(s)', n; END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'Client hub: PASS' AS result;
