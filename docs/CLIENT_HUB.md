# Client Hub — design spec (to build in a new session)

> **Status: designed, NOT built.** Build this FIRST in the next session (before the mobile
> phase). It's a light "client hub" — a directory + per-client summary over data we already
> have — **not a CRM.** Founder + assistant agreed the approach; this is the buildable spec.
> Read `docs/HANDOVER.md` for context and `docs/DECISIONS.md` #62/#63 for the sales/portal
> model it sits on top of.

---

## 1. Goal & scope

One place to answer *"pull up this client — who they are, what house(s) they bought, what
they've paid, what's due next, and their portal access."* Internal mirror of the client portal.

**Do build:**
- A **directory** of clients (buyers + partners), sortable by **outstanding / overdue** (collections at a glance).
- A **per-client page**: contact · their house(s) + milestone progress · payment status (paid /
  balance / **next tranche due**) · their portal link + last-opened · role.

**Do NOT build** (keep it construction-management, not Salesforce): lead pipeline, marketing,
task management, document vaults, message threads, calendars.

---

## 2. Data model (recommended: a thin `clients` table)

A "client" becomes first-class so a buyer can own >1 house, a partner can recur, and you can
attach notes + a portal link to a person. New migration (money-path-adjacent, so follow Rule 1
for any write path; the client record itself is not financial but links to sales/payments).

```sql
CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  full_name   TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'buyer',   -- buyer | partner | both
  email       TEXT,
  phone       TEXT,
  notes       TEXT,
  created_by  UUID REFERENCES memberships(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
-- RLS: org-scoped SELECT; NO client write policy (writes via fns below).

ALTER TABLE sales        ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE RESTRICT;
ALTER TABLE portal_links ADD COLUMN client_id UUID REFERENCES clients(id) ON DELETE RESTRICT;
```

**Migration of existing rows:** back-fill `clients` from the DISTINCT (party_name,email) already
on `sales`, then set `sales.client_id`. (There are only a handful today — Ada Buyer, Land Owner
Ltd, etc.) Alternatively start fresh; the hub tolerates unlinked sales (see §4).

**Write functions** (SECURITY DEFINER, manager-gated — mirror `fn_create_sale`):
- `fn_create_client(p_org, p_full_name, p_kind, p_email, p_phone, p_notes)` → uuid
- `fn_update_client(p_client, …)` — edit contact/notes/kind
- `fn_archive_client(p_client)` — soft-delete (like buildings/recipes)
- Extend `fn_create_sale` + `fn_create_portal_link` to accept an optional `p_client` and set
  `client_id`. (Keep the current inline `party_name` path working for ad-hoc entries.)

**Lighter fallback (if you want zero schema change for v1):** derive "clients" by grouping
`sale_payment_summary` on lower(email)|name; the hub becomes a pure view with no `clients`
table. Loses notes + can't link a portal link cleanly. Prefer the thin table.

---

## 3. Views

```sql
-- One row per client with rolled-up money + progress.
CREATE VIEW client_summary AS
SELECT c.id AS client_id, c.org_id, c.full_name, c.kind, c.email, c.phone,
       count(s.id)                                   AS sale_count,
       COALESCE(sum(sps.total_amount),0)             AS contract_value,
       COALESCE(sum(sps.paid),0)                     AS paid,
       COALESCE(sum(sps.outstanding),0)              AS outstanding
FROM clients c
LEFT JOIN sales s              ON s.client_id = c.id AND s.archived_at IS NULL
LEFT JOIN sale_payment_summary sps ON sps.sale_id = s.id
WHERE c.archived_at IS NULL
GROUP BY c.id;
-- + a "next due" per client = the earliest is_due AND unpaid tranche across their sales
--   (join payment_schedule where is_due AND pay_status <> 'paid', min due).
-- + "overdue" flag = has a due+unpaid tranche.
```

Per-client detail draws on existing views keyed by the client's sales: `payment_schedule`,
`building_milestones` (for each linked building), `portal_links` (their link + last-opened via
`portal_access_log`).

---

## 4. Web

- **`/clients`** (new nav item under "Clients", next to Sales & Portal links): directory table
  — Name · Role · Houses · Contract · Paid · **Outstanding** · Overdue badge · Open. Sort by
  outstanding desc; a filter for buyers vs partners. A "+ Add client" form.
- **`/clients/[id]`**: header (name, role, contact, edit) · a **money card** (contract / paid /
  outstanding / next due) · **their house(s)** each with a milestone stepper (reuse the building
  stepper) · **payment schedule(s)** (reuse `payment_schedule` render) · **portal link** (create/
  view/last-opened) · notes.
- Reuse components already built: the milestone stepper (building page), the payment schedule
  table (`/sales/[id]`), `PaymentPanel`, `PortalLinksPanel` patterns.
- Unlinked sales (no `client_id`) can be surfaced with a one-click "link to a client / create
  client from this sale."

---

## 5. Tests (register in `scripts/verify_all.sh`)

- `clients.sql`: create client → link a sale → `client_summary` rolls up contract/paid/
  outstanding across ≥2 sales; next-due picks the earliest due+unpaid tranche; archive hides it;
  authz (engineer/cross-org blocked on `fn_create_client`/`fn_update_client`); RLS org-isolation.
- Confirm `rls_isolation` still 49/0 with the new table.

---

## 6. Deploy

Same procedure as everything this session: `verify_all.sh` green → commit → Vercel push for web →
Supabase MCP `apply_migration` for the DB (see HANDOVER §3). Add DECISIONS #64 (Client Hub =
light aggregation over sales/portal/milestones, not a CRM; thin `clients` table).

---

## 7. Effort estimate

~1 migration (table + 2 alters + 3 fns + `client_summary` view), 1 test, 2 pages + small
components (mostly reuse). A focused half-day-ish build in a fresh, large-context session.
