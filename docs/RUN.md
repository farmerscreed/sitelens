# Running SiteLens locally (M1) — see and test the web app

## 0. One-time: enable the dev SMS provider
The Supabase CLI disables phone login unless an SMS provider is "enabled". We enabled a
placeholder Twilio provider in `config.toml`; it's never actually called for the dev
test-OTP numbers. Export a dummy token before starting:

```bash
export SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN=dev-unused
```

## 1. Bring up the FULL stack
If a previous partial `supabase start` left only the DB running (everything else shows
"Stopped services"), tear down first so all services come up:

```bash
supabase stop        # full teardown
supabase start       # db + auth + rest + kong + storage + studio …
```

`supabase start` also applies migrations. Then load seed data + the dev login fixture:

```bash
supabase db reset                                   # migrations + seed.sql
DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
psql "$DB_URL" -f supabase/seed_auth.sql            # links seeded orgs to login identities
```

> `seed_auth.sql` inserts `auth.users` rows whose IDs match the seeded
> `app_users`/`memberships`, so phone-OTP login lands you in Org A / Org B.

## 2. Run the web app
```bash
cd apps/web
cp .env.example .env.local
#   set NEXT_PUBLIC_SUPABASE_ANON_KEY from `supabase status`
npm install
npm run dev            # http://localhost:3000
```

## 3. Log in and test M1
- **Login** (`/login`): phone `+2348000000001` (Ada, Org A admin), OTP **123456**.
  (`+2348000000002` = Bode, Org B admin.)
- **Dashboard**: shows the decoded `active_org_id` claim → the A0 hook is working.
- **Price list** (`/prices`): set a dated price → cost re-costs live (AC-7).
- **Recipes** (`/recipes`): create a type, add a stage, set material quantities + a
  stage cost, watch the live cost; try Duplicate / New version.
- **BOQ import** (`/boq-import`): pick a type, upload `.xlsx`/`.csv` (or `.pdf`), map
  columns, stage → review → **confirm into recipe**. Re-import the same item name to see
  it auto-mapped (AC-5). Edge functions must be served for this:
  `supabase functions serve` (in another terminal), with `DEV_AI_MODE=true` for PDF.

## Verify the backend anytime (no app needed)
```bash
bash scripts/verify_all.sh     # rebuilds all migrations + seed, runs all 6 test suites
```

## Notes
- Org isolation is enforced by the DB (RLS). Log in as Bode and you see only Org B.
- All writes go through SECURITY DEFINER functions; the app never inserts into money/
  price/BOQ tables directly (Rule 1).
