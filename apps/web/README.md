# SiteLens web — command console

Next.js (App Router) + Tailwind. M1 command console. First screen delivered: **A0**
auth — phone-OTP login + org switch, proving the `active_org_id` JWT claim (injected by
the `custom_access_token_hook`) flows through to RLS.

## Run locally
Requires the local Supabase stack up (`supabase start`) and the DB seeded.

```bash
cd apps/web
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_ANON_KEY from `supabase status`
npm install
npm run dev            # http://localhost:3000
```

## Verify A0 end-to-end
1. Open `/login`, enter a seeded phone (`+2348000000001`), code `123456` (dev test OTP).
2. You land on `/dashboard`, which shows the decoded JWT claims — **`active_org_id` must
   be populated** (that's the A0 hook working). Every RLS-gated query now sees only that
   org's data.
3. If the user belongs to more than one org, the switcher changes the active org:
   it calls `fn_set_active_org`, refreshes the session (new token via the hook), and the
   claim + visible data change.

## Known integration point (dev fixtures)
Real GoTrue logins create `auth.users` rows with fresh UUIDs, which won't match the M0
seed's fixed `app_users`/`memberships` UUIDs. To demo the seeded orgs, link the seeded
identities to real auth users once the stack is up — either seed `auth.users` with the
fixed IDs + test phones, or provision on first login. (Account administration is a PRD
`[LATER]` item; this is only a dev-fixture concern.) The A0 auth *mechanism* — the hook,
`fn_set_active_org`, `fn_my_orgs` — is complete and unit-tested in
`supabase/tests/a0_token_hook.sql`.

## Not yet built (later M1 workstreams)
Catalogue, price editor, recipe editor, BOQ import + mapping screens — see
`docs/M1_PLAN.md` (workstreams B–G).
