-- ═══════════════════════════════════════════════════════════════════════════
-- M1 · G — hardening: (1) non-manager cannot use the M1 write paths; (2) RLS
-- isolation holds on the new tables (boq_column_mappings, active_org).
-- (Idempotency of confirm is covered by ac5_boq_import.sql; per-fn authz by
-- ac7_price_recost.sql and b_recipe.sql.) Runs in BEGIN/ROLLBACK.
--   docker exec -i supabase_db_sitelens psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 < supabase/tests/g_hardening.sql
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- An engineer (non-manager) in Org A.
INSERT INTO app_users (id, full_name, phone)
VALUES ('e1111111-1111-1111-1111-111111111111', 'Eng A', '+2348000000009');
INSERT INTO memberships (id, org_id, user_id, role)
VALUES ('e2222222-2222-2222-2222-222222222222',
        'a0000000-0000-0000-0000-0000000000aa',
        'e1111111-1111-1111-1111-111111111111', 'engineer');

DO $$
DECLARE
  org_a uuid := 'a0000000-0000-0000-0000-0000000000aa';
  org_b uuid := 'b0000000-0000-0000-0000-0000000000bb';
  mat_a uuid := 'a7777777-7777-7777-7777-777777777777';
  user_a uuid := 'a1111111-1111-1111-1111-111111111111';
  user_b uuid := 'b2222222-2222-2222-2222-222222222222';
  eng    uuid := 'e1111111-1111-1111-1111-111111111111';
  typ uuid; imp uuid; n int; fails int := 0;
BEGIN
  -- Admin A sets up a type + import so the engineer has something to attack.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  typ := fn_create_building_type(org_a, 'G Type', 'custom');
  imp := fn_create_boq_import(org_a, typ, 'xlsx');

  -- ── (1) engineer is blocked on every manager-gated write ──
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', eng)::text, true);
  BEGIN PERFORM fn_create_building_type(org_a, 'nope', 'custom');
    RAISE WARNING 'engineer created a type'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_set_material_price(org_a, mat_a, 1, CURRENT_DATE);
    RAISE WARNING 'engineer set a price'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_add_type_stage(typ, 'nope', 1);
    RAISE WARNING 'engineer edited a recipe'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_stage_boq_rows(imp, '[{"raw_text":"x","parsed_qty":"1"}]');
    RAISE WARNING 'engineer staged import rows'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM fn_confirm_boq_import(imp, '[]'::jsonb);
    RAISE WARNING 'engineer confirmed an import'; fails:=fails+1;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;

  -- ── (2) RLS isolation on the new tables ──
  -- Seed a mapping + active org for each side (as the respective admins).
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_a)::text, true);
  PERFORM fn_remember_column_mapping(org_a, 'sigA', '{"item":0}'::jsonb);
  PERFORM fn_set_active_org(org_a);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', user_b)::text, true);
  PERFORM fn_remember_column_mapping(org_b, 'sigB', '{"item":0}'::jsonb);
  PERFORM fn_set_active_org(org_b);

  -- View as an authenticated Org A user.
  SET LOCAL ROLE authenticated;
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('role','authenticated','sub',user_a,'active_org_id',org_a)::text, true);

  SELECT count(*) INTO n FROM boq_column_mappings WHERE org_id = org_b;
  IF n <> 0 THEN RAISE WARNING 'LEAK: Org A saw Org B column mapping'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM boq_column_mappings WHERE org_id = org_a;
  IF n <> 1 THEN RAISE WARNING 'Org A cannot see its own column mapping (%)', n; fails:=fails+1; END IF;

  SELECT count(*) INTO n FROM active_org WHERE user_id = user_b;
  IF n <> 0 THEN RAISE WARNING 'LEAK: user A saw user B active_org'; fails:=fails+1; END IF;
  SELECT count(*) INTO n FROM active_org WHERE user_id = user_a;
  IF n <> 1 THEN RAISE WARNING 'user A cannot see own active_org (%)', n; fails:=fails+1; END IF;

  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF fails > 0 THEN RAISE EXCEPTION 'G hardening FAILED: % assertion(s)', fails; END IF;
  RAISE NOTICE 'G PASS: non-manager blocked on all M1 write paths; new tables org-isolated.';
END $$;
ROLLBACK;
SELECT 'G hardening: PASS' AS result;
