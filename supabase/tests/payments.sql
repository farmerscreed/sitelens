-- ═══════════════════════════════════════════════════════════════════════════
-- Sales & payments (money path): buyer milestone plan (20/15/15/15/15/20) and
-- partner time-phased plan (30% + 4×17.5%); waterfall paid/unpaid; a tranche is due
-- immediately (booking) / when its milestone is reached; payments are idempotent and
-- voidable; cross-org cannot record. BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj  uuid := 'a5555555-5555-5555-5555-555555555555';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  typ uuid; s_sub uuid; bld uuid; sale uuid; partner uuid; pay uuid;
  q numeric; st text; due boolean; n int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'Pay Type', 'terrace');
  s_sub := fn_add_type_stage(typ, 'Substructure', 1);   -- → Foundation milestone
  PERFORM fn_add_type_stage(typ, 'Roof', 2);
  PERFORM fn_create_buildings(typ, 1, proj, NULL, NULL, 'PAY');
  SELECT id INTO bld FROM buildings WHERE project_id=proj AND building_type_id=typ LIMIT 1;

  -- Buyer sale (milestone), total 10,000,000 → 6 tranches.
  sale := fn_create_sale(org_a, proj, bld, 'Ada Buyer', 'buyer', 10000000, 'milestone');
  SELECT count(*) INTO n FROM payment_tranches WHERE sale_id = sale;
  IF n <> 6 THEN RAISE WARNING 'buyer tranches=% (exp 6)', n; fails:=fails+1; END IF;
  SELECT amount, is_due INTO q, due FROM payment_schedule WHERE sale_id=sale AND seq=1;   -- Booking 20%
  IF q <> 2000000 THEN RAISE WARNING 'booking amount=% (exp 2000000)', q; fails:=fails+1; END IF;
  IF NOT due THEN RAISE WARNING 'booking not due immediately'; fails:=fails+1; END IF;
  SELECT is_due INTO due FROM payment_schedule WHERE sale_id=sale AND seq=2;               -- Foundation
  IF due THEN RAISE WARNING 'foundation due before its milestone'; fails:=fails+1; END IF;

  -- Record the booking payment → paid 2,000,000; booking paid, foundation unpaid.
  pay := fn_record_payment(gen_random_uuid(), sale, 2000000, 'pay-1');
  SELECT paid INTO q FROM sale_payment_summary WHERE sale_id=sale;
  IF q <> 2000000 THEN RAISE WARNING 'paid=% (exp 2000000)', q; fails:=fails+1; END IF;
  SELECT pay_status INTO st FROM payment_schedule WHERE sale_id=sale AND seq=1;
  IF st <> 'paid' THEN RAISE WARNING 'booking status=% (exp paid)', st; fails:=fails+1; END IF;
  SELECT pay_status INTO st FROM payment_schedule WHERE sale_id=sale AND seq=2;
  IF st <> 'unpaid' THEN RAISE WARNING 'foundation status=% (exp unpaid)', st; fails:=fails+1; END IF;

  -- Idempotent: same key → no duplicate.
  PERFORM fn_record_payment(gen_random_uuid(), sale, 2000000, 'pay-1');
  SELECT count(*) INTO n FROM payments WHERE sale_id=sale AND voided_at IS NULL;
  IF n <> 1 THEN RAISE WARNING 'idempotent retry duplicated (%)', n; fails:=fails+1; END IF;

  -- Reaching the Foundation milestone makes that tranche due.
  PERFORM fn_complete_stage(bld, s_sub);
  SELECT is_due INTO due FROM payment_schedule WHERE sale_id=sale AND seq=2;
  IF NOT due THEN RAISE WARNING 'foundation not due after milestone reached'; fails:=fails+1; END IF;

  -- Void reverses.
  PERFORM fn_void_payment(pay, 'test');
  SELECT paid INTO q FROM sale_payment_summary WHERE sale_id=sale;
  IF q <> 0 THEN RAISE WARNING 'void did not reverse (paid=%)', q; fails:=fails+1; END IF;

  -- Partner sale (time-phased), project-level, total 100,000,000 → 5 tranches (30 + 4×17.5).
  partner := fn_create_sale(org_a, proj, NULL, 'Land Owner Ltd', 'partner', 100000000, 'time_phased');
  SELECT count(*) INTO n FROM payment_tranches WHERE sale_id=partner;
  IF n <> 5 THEN RAISE WARNING 'partner tranches=% (exp 5)', n; fails:=fails+1; END IF;
  SELECT amount INTO q FROM payment_schedule WHERE sale_id=partner AND seq=1;   -- Initial 30%
  IF q <> 30000000 THEN RAISE WARNING 'initial=% (exp 30000000)', q; fails:=fails+1; END IF;
  SELECT amount INTO q FROM payment_schedule WHERE sale_id=partner AND seq=2;   -- Phase 1 17.5%
  IF q <> 17500000 THEN RAISE WARNING 'phase1=% (exp 17500000)', q; fails:=fails+1; END IF;

  -- Authz: cross-org cannot record a payment.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  BEGIN PERFORM fn_record_payment(gen_random_uuid(), sale, 1000, 'pay-x');
    RAISE WARNING 'cross-org recorded a payment'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'PAYMENTS FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'PAYMENTS PASS: buyer milestone + partner time-phased plans; waterfall paid/unpaid; due on milestone/immediate; idempotent; void reverses; authz.';
END $$;
ROLLBACK;
SELECT 'Sales & payments: PASS' AS result;
