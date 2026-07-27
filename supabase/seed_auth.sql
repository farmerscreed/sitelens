-- DEV login fixture. Real GoTrue logins mint auth.users rows with fresh UUIDs that
-- won't match the seed's fixed app_users/memberships IDs. This inserts auth.users
-- rows whose IDs EQUAL the seeded identities and whose phones match the dev test-OTP
-- numbers, so phone-OTP login lands you straight in Org A / Org B.
--
-- Run AFTER `supabase db reset` (which loads seed.sql):
--   psql "$DB_URL" -f supabase/seed_auth.sql
-- (DB_URL from `supabase status -o env`.)  Dev only — never ships.

INSERT INTO auth.users (
  instance_id, id, aud, role, phone, phone_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000',
   'a1111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated',
   '+2348000000001', NOW(),
   '{"provider":"phone","providers":["phone"]}', '{}', NOW(), NOW()),
  ('00000000-0000-0000-0000-000000000000',
   'b2222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated',
   '+2348000000002', NOW(),
   '{"provider":"phone","providers":["phone"]}', '{}', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Login: phone +2348000000001 (Ada, Org A admin) or +2348000000002 (Bode, Org B admin),
-- dev OTP 123456. The A0 access-token hook then injects active_org_id from the matching
-- membership, so RLS scopes everything to that org.
