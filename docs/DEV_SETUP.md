# DEV_SETUP — get SiteLens onto another computer

Two different things you might mean by "access it elsewhere":

- **Just USE the app** → it's already online. Open **https://sitelens-eosin.vercel.app**
  in any browser on any device and log in with your email (biebele@gmail.com → 6-digit
  code). Nothing to install.
- **Pull the CODE down to develop / run it** → follow the steps below. ~10 minutes.

---

## What you need on the new machine
- **Git** and **Node.js 18+** (`node -v`). Node from https://nodejs.org.
- **GitHub access** to `farmerscreed/sitelens` (log in as the farmerscreed account).
- *(optional, only for a full LOCAL database)* **Docker** + the **Supabase CLI**.
- *(optional)* **Claude Code** — see the last section.

## 1. Clone the repo
```bash
# easiest: GitHub CLI
gh auth login                       # sign in as farmerscreed
gh repo clone farmerscreed/sitelens
# or plain git
git clone https://github.com/farmerscreed/sitelens.git
cd sitelens
```

## 2. Recreate the secret files (they are NOT in git — by design)
`.env` files are git-ignored, so cloning does **not** bring the keys. Get the values from
the Supabase dashboard (Project → Settings → API / Database) **or** copy the two files off
your current machine with a USB/secure transfer. You need:

**`apps/web/.env.local`** (the web console → cloud Supabase):
```
NEXT_PUBLIC_SUPABASE_URL=https://gwzpqnnwflwkcrowolgx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from dashboard → Settings → API>
```

**`.env`** (repo root — admin scripts / running tests against cloud). Keys:
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`,
`OPENROUTER_API_KEY`, `RESEND_API_KEY`, `TERMII_API_KEY`. Copy from the current `.env` or
the dashboard. **Never commit these.** A blank template is in `.env.example`.

## 3a. Run the web console (against the live cloud DB) — the common case
```bash
cd apps/web
npm install
npm run dev          # → http://localhost:3000  (log in with your email)
```
That's it — it talks to the same cloud database as production.

## 3b. (Optional) Run a full LOCAL database from scratch
Only if you want an offline/local Postgres instead of cloud:
```bash
supabase start                 # boots local Postgres+Auth in Docker
supabase db reset              # rebuilds EVERYTHING from supabase/migrations + seed
```
Then point `apps/web/.env.local` at the local URL/anon that `supabase start` prints.
`supabase db reset` rebuilding cleanly is the portability guarantee (CLAUDE.md).

## 4. Deploy changes
Push to `master` → Vercel auto-builds. **Commits must be authored as**
`29656494+farmerscreed@users.noreply.github.com` or Vercel Hobby blocks the deploy
(see WEB_CONSOLE.md §2). On a fresh clone set it once:
```bash
git config user.name  "farmerscreed"
git config user.email "29656494+farmerscreed@users.noreply.github.com"
```

## 5. Using Claude Code on the new machine
Install Claude Code, then run it from inside the `sitelens/` folder. It automatically reads
`CLAUDE.md` (the standing orders) and the `docs/` folder — **the committed `docs/` are the
portable source of truth**, so a brand-new session on a brand-new computer is fully briefed
from the repo alone. Start by reading, in order: `docs/STATUS.md` → `docs/WEB_CONSOLE.md` →
`docs/CLOUD_MIGRATION.md` → `docs/DECISIONS.md`.

> Note: Claude Code's separate auto-**memory** lives under your home dir
> (`~/.claude/projects/…/memory/`), not in the repo, so it does **not** transfer with a
> clone. That's fine — everything important is duplicated into `docs/`. If you want the
> memory too, copy that folder across manually.

## Quick reference
| Thing | Value |
|---|---|
| Live app | https://sitelens-eosin.vercel.app |
| Repo | github.com/farmerscreed/sitelens (branch `master`, web root `apps/web`) |
| Cloud Supabase | project ref `gwzpqnnwflwkcrowolgx` (London) |
| Login | email OTP, biebele@gmail.com |
| Deploy | push to `master` (as farmerscreed) → Vercel |
