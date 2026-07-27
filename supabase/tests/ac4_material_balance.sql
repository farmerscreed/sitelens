-- ═══════════════════════════════════════════════════════════════════════════
-- M5 — AC-4: material balances are always accurate and can NEVER go negative.
-- Also: idempotent (no double-count on resend), void reversal, reorder alert,
-- transfer pairing. Runs in BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
DELETE FROM material_transactions WHERE project_id = 'a5555555-5555-5555-5555-555555555555';
DELETE FROM material_balances     WHERE project_id = 'a5555555-5555-5555-5555-555555555555';

DO $$
DECLARE
  proj uuid := 'a5555555-5555-5555-5555-555555555555';
  mat  uuid := 'a7777777-7777-7777-7777-777777777777';   -- reorder_level default 10
  bld  uuid := 'aabb0000-0000-0000-0000-0000000000a1';   -- seeded building in projA
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  out60 uuid := gen_random_uuid(); out95 uuid := gen_random_uuid();
  tin uuid := gen_random_uuid(); tout uuid := gen_random_uuid();
  bal numeric; n int; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'IN', 100, 'k-in-1');
  SELECT balance INTO bal FROM material_balances WHERE project_id=proj AND material_id=mat;
  IF bal <> 100 THEN RAISE WARNING 'after IN 100 bal=%', bal; fails:=fails+1; END IF;

  PERFORM fn_log_material_txn(out60, proj, mat, 'OUT', 60, 'k-out-1', p_building=>bld);
  SELECT balance INTO bal FROM material_balances WHERE project_id=proj AND material_id=mat;
  IF bal <> 40 THEN RAISE WARNING 'after OUT 60 bal=%', bal; fails:=fails+1; END IF;

  -- OUT 50 would go negative → rejected, balance unchanged.
  BEGIN
    PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'OUT', 50, 'k-out-2', p_building=>bld);
    RAISE WARNING 'negative OUT was NOT rejected'; fails:=fails+1;
  EXCEPTION WHEN others THEN NULL; END;
  SELECT balance INTO bal FROM material_balances WHERE project_id=proj AND material_id=mat;
  IF bal <> 40 THEN RAISE WARNING 'balance moved after rejected OUT (bal=%)', bal; fails:=fails+1; END IF;

  -- Idempotency: resend IN with the same key → no double count.
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'IN', 100, 'k-in-1');
  SELECT balance INTO bal FROM material_balances WHERE project_id=proj AND material_id=mat;
  IF bal <> 40 THEN RAISE WARNING 'idempotent resend double-counted (bal=%)', bal; fails:=fails+1; END IF;

  -- Void the OUT 60 (admin) → balance reverses to 100.
  PERFORM fn_void_material_txn(out60, 'miskeyed quantity');
  SELECT balance INTO bal FROM material_balances WHERE project_id=proj AND material_id=mat;
  IF bal <> 100 THEN RAISE WARNING 'void did not reverse (bal=%)', bal; fails:=fails+1; END IF;

  -- Reorder alert: drop below level 10.
  PERFORM fn_log_material_txn(out95, proj, mat, 'OUT', 95, 'k-out-3', p_building=>bld);   -- bal 5
  SELECT count(*) INTO n FROM audit_log WHERE action='reorder_alert' AND entity_id=mat;
  IF n < 1 THEN RAISE WARNING 'no reorder alert below level'; fails:=fails+1; END IF;

  -- Transfer 2 (same project, same building for the test) → paired OUT/IN linked.
  PERFORM fn_transfer_material(tout, tin, proj, proj, mat, 2, bld, bld, 'k-xfer-1');
  IF (SELECT transfer_pair_id FROM material_transactions WHERE id=tout) <> tin
     OR (SELECT transfer_pair_id FROM material_transactions WHERE id=tin) <> tout THEN
    RAISE WARNING 'transfer not paired'; fails:=fails+1; END IF;
  SELECT balance INTO bal FROM material_balances WHERE project_id=proj AND material_id=mat;
  IF bal <> 5 THEN RAISE WARNING 'transfer net wrong (bal=%)', bal; fails:=fails+1; END IF;   -- 5 -2 +2

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'AC-4 FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'AC-4 PASS: balance accurate; negative rejected; idempotent; void reverses; reorder alert; transfer paired.';
END $$;
ROLLBACK;
SELECT 'AC-4 material balance: PASS' AS result;
