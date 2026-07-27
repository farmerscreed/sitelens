# M5 plan — Materials + expenses + approvals + requirement-vs-actual

> Milestone flipped M4→M5. Building through. Fully DB-verifiable (the most money-path,
> fraud-sensitive milestone — Rule 1 everywhere).

## Gates
- **AC-4:** material balances are always accurate and **can never go negative**.
- **AC-9:** a building's **stage overrun (used > required) flags at completion**, per stage.
- **AC-11:** expenses above threshold **cannot be recorded as spent without approval**.
- (AC-12 extends: voids/approvals appear in the audit log.)

## PRD basis
§9 F-10 (materials), F-11 (expenses); §10 (data chain / requirement-vs-actual, closes the
M2 board's "consumed vs required" seam); §16.4 `fn_log_material_txn`, `fn_void_material_txn`,
`fn_create_expense`, `fn_approve_expense`. Tables exist (materials_catalog,
material_transactions, material_balances, expenses, budget_lines) with idempotency_keys
for offline; material_transactions already has building_id/stage_id/batch_id (v3 ALTER).

## Workstreams
- **A — materials (money-path):**
  - `fn_upsert_material` (admin maintains the catalogue — F-10.1).
  - **`fn_log_material_txn`** (IN/OUT): idempotent on idempotency_key (offline-safe);
    **row-locks `material_balances` (`FOR UPDATE`)**, maintained never-recomputed-on-read
    (F-10.4); an OUT that would drive the balance negative is **rejected** (F-10.5, AC-4);
    validates material/budget-line/building; requires building on OUT (tag for
    requirement-vs-actual); writes a reorder-alert audit entry when balance drops below
    the catalogue reorder level (F-10.6).
  - **`fn_void_material_txn`** (Admin only, reason required): reverses the balance under
    lock, audited (F-10.8); refuses a reversal that would go negative.
  - **`fn_transfer_material`**: a paired OUT/IN linked by `transfer_pair_id` (F-10.7).
- **B — expenses + approvals:**
  - **`fn_create_expense`**: budget line mandatory; idempotent; status **`pending`**
    (committed, not spent — F-11.2); records the required approver level from the org's
    thresholds (`organizations.settings.expense_thresholds`, default PM ≤ ₦50k, Admin
    > ₦250k).
  - **`fn_approve_expense`**: the approver must have authority for the amount (> ₦250k ⇒
    Admin; engineers can't approve) — AC-11.
  - **`fn_void_expense`** (Admin only, reason, audited — F-11.3).
- **C — requirement-vs-actual (closes M2's seam):**
  - `building_req_vs_actual` view (security_invoker): per building/material, **required**
    (Σ recipe qty for completed stages) vs **consumed** (Σ material OUT tagged to the
    building) + overrun.
  - **`fn_complete_stage` extended** (M2) to run the check at completion: for the stage's
    required materials, if consumed > required, write a `stage_overrun` audit flag "at the
    pour" (AC-9).
- **D — tests:** `ac4_material_balance` (IN/OUT, negative rejection, idempotency no
  double-count, void reversal, reorder flag, transfer), `ac9_overrun` (overrun flags at
  completion), `ac11_expense_approval` (threshold routing, approver authority, void,
  authz).
- **E — web UI:** materials (catalogue, log IN/OUT, balances + reorder alerts), expenses
  (create, approve, list), and the building card's **consumed-vs-required** now filled in.

## Files
```
supabase/migrations/2026…_m5a_materials.sql     fn_upsert_material, fn_log_material_txn, fn_void_material_txn, fn_transfer_material
supabase/migrations/2026…_m5b_expenses.sql      fn_create_expense, fn_approve_expense, fn_void_expense
supabase/migrations/2026…_m5c_req_actual.sql    building_req_vs_actual view + fn_complete_stage overrun check
supabase/tests/                                 ac4_material_balance, ac9_overrun, ac11_expense_approval
apps/web/app/materials, app/expenses            + building card consumed-vs-required
```

## Verification
`bash scripts/verify_all.sh` extended with the three M5 suites; all prior suites stay
green. DB verified via docker exec; UI code-complete + typechecked.

## Decisions (noted, recommended defaults)
1. **Expense thresholds live in `organizations.settings.expense_thresholds`** (JSONB),
   default `{pm: 50000, admin: 250000}` — per-org configurable without a schema change.
2. **OUT requires a building tag** (so requirement-vs-actual is always computable);
   stage is recommended and needed for the per-stage overrun flag.
3. **Overrun "flag" = an audit_log entry at completion + the live `building_req_vs_actual`
   view** (PRD §10: "mostly query logic, not new tables"). A dedicated discrepancies
   table can come later if the review UX needs it.
