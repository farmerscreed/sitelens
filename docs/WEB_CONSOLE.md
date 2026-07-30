# WEB_CONSOLE — SiteLens command console (apps/web)

The Next.js web app: the founder's command console + the client portal. This is the
single reference for how it's built, styled, deployed, and authenticated. Read it before
touching `apps/web`.

---

## 1. Where it lives

- **Code:** `apps/web` (Next.js 14.2 App Router, React 18, Tailwind, TypeScript).
- **Repo:** github.com/farmerscreed/sitelens (private), branch `master`, root dir `apps/web`.
- **Prod URL:** https://sitelens-eosin.vercel.app (Vercel project `sitelens`,
  team `team_ZgdrUMsVFDgiLDp1XSdNIjkL`). Auto-deploys on every push to `master`.
- **Backend:** cloud Supabase `gwzpqnnwflwkcrowolgx` (London). Env in `apps/web/.env.local`
  (git-ignored): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The same two
  vars are set in Vercel project settings.
- **Deps:** only `@supabase/ssr`, `@supabase/supabase-js`, `next`, `react`. No UI library,
  no icon package — icons are hand-rolled inline SVG (`components/icons.tsx`).

## 2. Deploying — the Vercel committer gotcha

Vercel **Hobby tier blocks any deploy whose git commit email is not linked to a GitHub
account on the team.** Commits authored as `biebele@gmail.com` are BLOCKED (state
`BLOCKED`, never built). Local git is configured to commit as:

```
git config user.name  "farmerscreed"
git config user.email "29656494+farmerscreed@users.noreply.github.com"
```

Always commit with that identity. To ship: commit → `git push origin master` → Vercel
builds the new HEAD automatically. Check state with the Vercel MCP `list_deployments`
(look for `state: READY`). Do **not** force real deploys any other way.

## 3. Auth (how login works)

Primary = **email OTP**. Founder logs in with **biebele@gmail.com**:
`signInWithOtp({ email, options: { shouldCreateUser: false } })` → 6-digit code →
`verifyOtp({ email, token, type: "email" })` → redirect `/dashboard`.

- Cloud GoTrue uses **Resend SMTP** (`smtp.resend.com:465`, user `resend`), sender
  **`noreply@leiko.app`** (leiko.app is the verified Resend domain — an unverified Resend
  sender only delivers to the account owner, tawokels@gmail.com). Email rate limit = 100/hr.
- On token issue, the `custom_access_token` hook injects `active_org_id` / `user_role` /
  `membership_id` claims → this is what every RLS policy gates on.
- **Phone OTP (Termii)** exists in the login UI (Phone tab) and DB, but the `send-sms`
  auth hook is **DISABLED** (it 500'd). Re-enable for the Flutter field app later.
- Provisioning a login for a user by hand: the `auth.users` row needs matching
  `auth.identities` rows (email/phone) AND non-NULL token columns (GoTrue can't scan NULL
  `confirmation_token` etc. — COALESCE them to `''`).

See decisions #37 in `docs/DECISIONS.md` and `docs/CLOUD_MIGRATION.md`.

## 4. Architecture

```
app/
  layout.tsx        root; loads Inter+JetBrains (next/font), className="dark", wraps <Shell>
  globals.css       design system (tokens + component classes) — see §5
  page.tsx          "/" → redirect to /dashboard or /login
  login/            email+phone OTP (client component; the only "bare" authed-adjacent page)
  dashboard/        overview: live KPI cards + quick-launch + tenant-isolation status
  board/            buildings by stage      \
  materials/        stock + reorder advice   |  each: server component, auth-gates,
  expenses/         spend vs budget          |  RLS-scoped SELECTs, project switcher
  prices/ recipes/ planner/ boq-import/      |  via <ProjectPicker>, writes via RPC only
  ask/ ai/ portal-links/ notifications/      /
  portal/[token]/   PUBLIC client portal (PIN-gated; NOT wrapped by the console shell)
components/
  Shell.tsx         app shell: sidebar + topbar + org switcher + mobile drawer (client)
  ProjectPicker.tsx client <select> that navigates via ?project= (fixes the 500 — §6)
  PageHeader.tsx    consistent page title/subtitle/actions
  icons.tsx         inline SVG icon set (no external dep)
  <Feature>.tsx     Board, ExpensesPanel, LogTxnForm, RecipeEditor, AskBox, … (client)
lib/
  supabase/server.ts   createServerClient (cookies) — server components / route handlers
  supabase/client.ts   createBrowserClient — client components
  activeOrg.ts         decode active_org_id from the JWT (display only; DB enforces via RLS)
```

**Server vs client:** pages are server components that authenticate (`getUser()` →
`redirect("/login")`), read RLS-scoped data, and hand it to client components for
interaction. `Shell` is a client component (needs `usePathname` + client Supabase for the
org switcher); it receives already-rendered server `children` and renders chrome around
them — except on `/login`, `/`, and `/portal/*`, where it returns `children` bare.

**Money/RLS rules are unchanged and still enforced by the DB.** The web app never writes
money/price/BOQ directly — every mutation calls a `SECURITY DEFINER` RPC (`fn_*`). Reads
are plain RLS-scoped SELECTs. Nothing in the redesign touched the Four Golden Rules.

## 5. Design system (the "command console" look)

Dark, high-contrast, amber hi-vis accent (construction identity), glass panels, ambient
radial-glow + faint-grid background. Committed to a single dark theme on purpose (site /
low-light use) via Tailwind `darkMode: "class"` + `.dark` pinned on `<html>` — so every
legacy `bg-white dark:bg-neutral-900` pair renders its dark side with no rewrite.

- **Tokens / theme:** `tailwind.config.ts` — colors `ink.*` (canvas) + `accent.*` (amber),
  `font-sans`=Inter / `font-mono`=JetBrains, shadows (`glow`/`panel`/`lift`), the
  `accent-sheen` gradient, and animations (`fade-up`, `shimmer`, `pulse-glow`).
- **Component classes** (in `app/globals.css`, use these instead of re-styling ad hoc):
  `.card` / `.card-hover`, `.stat` `.stat-label` `.stat-value`, `.btn` `.btn-primary`
  `.btn-ghost` `.btn-danger`, `.input` `.select` `.textarea` `.label`, `.badge` +
  `.badge-accent|green|red|blue|muted`, `.table-base`, `.gradient-text`, `.muted`,
  `.nav-item` / `.nav-item-active`.
- **Background** is drawn by `body::before` (glow) + `body::after` (masked grid) in
  globals.css — global, no per-page work.

To restyle or add a page: wrap content in a `<div className="space-y-6">`, lead with
`<PageHeader title subtitle>` (+ a `<ProjectPicker>` in its actions slot if project-scoped),
and build with `.card` / `.table-base` / `.badge`. Never re-introduce a `<main>` inside a
page — the shell already renders one.

## 6. The 500 bug (do not reintroduce)

A **server component cannot pass an event handler to a DOM element** — e.g.
`<select onChange={…}>` in a non-`"use client"` file throws at render:
*"Event handlers cannot be passed to Client Component props"* → HTTP 500. It passes the
build and only fails at runtime. This crashed /board /materials /expenses /portal-links.
Fix = the client `components/ProjectPicker.tsx`. **Rule: any interactive control (onChange,
onClick, …) belongs in a client component.** (Decision #38.)

## 7b. Projects & the active project (multi-project)

The app is multi-project per org. Isolation is DB-enforced: every operational table gates on
`has_project_access(project_id)`, and `projects_select` = `org_id = current_org_id() AND
has_project_access(id)`. Admins/PMs see all org projects; other roles only ones they're
added to via `project_members`. Recipes / prices / plans are **org-wide by design** (shared
across projects); buildings, stock, expenses, reports, portal links are per-project.

- **Create/rename/archive** go through SECURITY DEFINER fns (`fn_create_project`,
  `fn_rename_project`, `fn_archive_project`; migration `20260729000000_projects_write_fns`),
  admin/PM only. Projects keep SELECT-only RLS — no direct client insert.
- **Active project is sticky** via the `sl_project` cookie. `lib/activeProject.ts` resolves
  it as **URL `?project=` > cookie > first accessible project**, honouring the cookie only if
  the id is in the caller's RLS-scoped list (a stale/copied cookie falls back — it can never
  surface another project's data).
- **UI:** `/projects` (`components/ProjectsManager.tsx`) to create/manage; the top-bar
  `components/ProjectSwitcher.tsx` (shown on `/board /materials /expenses /portal-links`)
  switches the active project. `components/ProjectPicker.tsx` is now unused (kept for reuse).

## 7. Known-good verification

- `cd apps/web && npm run build` → compiles, 17/17 routes.
- `npm run` — dev: `next dev`; prod check: `next build`.
- Prod smoke: unauthenticated `GET /board /materials /expenses /dashboard` → **307**
  (redirect to /login), never 500.
- Login end-to-end: email biebele@gmail.com → code arrives → lands on the dark dashboard.

## 2026-07-30 addendum — BOQ true-cost surfaces

- **/assemblies** (new, sidebar "Design"): mix library — ratio calculator (grade
  sanity table), waste factors, reusable formwork, unit-conversions editor.
- **/boq-import**: readiness note (stages/materials counts, never a gate); upload
  creates the import row first, then polls `boq_imports.status,progress` every 2 s
  for a real stepper (decoding → AI reading n of m → arithmetic → staging; step
  'error' surfaces the server message).
- **/boq-import/[id]** review v2: reconciliation banner, element groups (ordered by
  `row_no`), machine-flag chips, "Set up from this bill" panel (bootstrap stages /
  materials+prices), kind + assembly selects; confirm → `fn_confirm_boq_import_v2`.
- **/recipes/[id]**: "True cost (work items)" (3-number header, live build-up vs BOQ
  variance) + "Material take-off". **/buildings/[id]**: "Earned value" + work-done
  logging. **/ai**: price-proposal chooser (accept = set current price).
