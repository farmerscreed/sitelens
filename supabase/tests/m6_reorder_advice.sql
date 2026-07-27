-- ═══════════════════════════════════════════════════════════════════════════
-- M6 — reorder advice matches remaining BOQ (AI-9). remaining = recipe − consumed;
-- order_qty = max(0, remaining − in-stock). BEGIN/ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
INSERT INTO projects (id, org_id, name, created_by)
VALUES ('cbb00000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-0000000000aa',
        'Reorder Estate', 'a1111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  proj uuid := 'cbb00000-0000-0000-0000-0000000000c1';
  mat  uuid := 'a7777777-7777-7777-7777-777777777777';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  typ uuid; stg uuid; b1 uuid; adv jsonb; row jsonb; fails int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);

  typ := fn_create_building_type(org_a, 'Reorder Type', 'terrace');
  stg := fn_add_type_stage(typ, 'Foundation', 1);
  PERFORM fn_set_type_boq_item(typ, stg, mat, 100, 'bag');       -- 100 per building
  PERFORM fn_create_buildings(typ, 2, proj, NULL, NULL, 'R');    -- required = 200
  SELECT id INTO b1 FROM buildings WHERE project_id=proj AND code='R001';

  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'IN', 80, 'ro-in');            -- stock 80
  PERFORM fn_log_material_txn(gen_random_uuid(), proj, mat, 'OUT', 50, 'ro-out', p_building=>b1); -- consumed 50, stock 30

  adv := fn_reorder_advice(proj);
  SELECT e INTO row FROM jsonb_array_elements(adv) e WHERE (e->>'material_id')::uuid = mat;

  IF (row->>'required')::numeric  <> 200 THEN RAISE WARNING 'required=% (exp 200)', row->>'required'; fails:=fails+1; END IF;
  IF (row->>'consumed')::numeric  <> 50  THEN RAISE WARNING 'consumed=% (exp 50)', row->>'consumed'; fails:=fails+1; END IF;
  IF (row->>'in_stock')::numeric  <> 30  THEN RAISE WARNING 'in_stock=% (exp 30)', row->>'in_stock'; fails:=fails+1; END IF;
  IF (row->>'remaining')::numeric <> 150 THEN RAISE WARNING 'remaining=% (exp 150)', row->>'remaining'; fails:=fails+1; END IF;
  IF (row->>'order_qty')::numeric <> 120 THEN RAISE WARNING 'order_qty=% (exp 120)', row->>'order_qty'; fails:=fails+1; END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  IF fails > 0 THEN RAISE EXCEPTION 'reorder FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'reorder PASS: required 200, consumed 50, stock 30 → remaining 150, order 120 (matches remaining BOQ).';
END $$;
ROLLBACK;
SELECT 'M6 reorder advice: PASS' AS result;
