"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Expense = { id: string; amount: number; status: string; description: string | null; paid_to: string | null; budget_line_id: string; created_at: string };
type BudgetLine = { id: string; name: string; cost_code: string };

const badge: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800", approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800", voided: "bg-neutral-200 text-neutral-600",
};

export function ExpensesPanel({ projectId, expenses, budgetLines }: { projectId: string; expenses: Expense[]; budgetLines: BudgetLine[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // create form
  const [bl, setBl] = useState(budgetLines[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) setErr(error.message); else router.refresh();
  }

  async function create() {
    await call("fn_create_expense", {
      p_id: crypto.randomUUID(), p_project: projectId, p_budget_line: bl,
      p_amount: Number(amount), p_idempotency_key: crypto.randomUUID(), p_description: desc,
    });
    setAmount(""); setDesc("");
  }

  return (
    <div className="space-y-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
            <th className="py-1">Amount</th><th>Description</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((e) => (
            <tr key={e.id} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-1 font-mono">₦{Number(e.amount).toLocaleString()}</td>
              <td>{e.description ?? "—"}</td>
              <td><span className={`rounded px-2 py-0.5 text-xs ${badge[e.status] ?? ""}`}>{e.status}</span></td>
              <td className="text-right">
                {e.status === "pending" && (
                  <button className="mr-2 rounded border px-2 py-0.5 text-xs dark:border-neutral-700" disabled={busy}
                    onClick={() => call("fn_approve_expense", { p_expense: e.id })}>Approve</button>
                )}
                {e.status !== "voided" && (
                  <button className="rounded border px-2 py-0.5 text-xs dark:border-neutral-700" disabled={busy}
                    onClick={() => call("fn_void_expense", { p_expense: e.id, p_reason: "voided from console" })}>Void</button>
                )}
              </td>
            </tr>
          ))}
          {expenses.length === 0 && <tr><td colSpan={4} className="py-2 text-neutral-500">No expenses yet.</td></tr>}
        </tbody>
      </table>

      <div className="max-w-2xl space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-medium">Record an expense</h2>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <select className="rounded border px-2 py-1 dark:bg-neutral-900" value={bl} onChange={(e) => setBl(e.target.value)}>
            {budgetLines.map((l) => <option key={l.id} value={l.id}>{l.cost_code} · {l.name}</option>)}
          </select>
          <input type="number" min="0" className="w-32 rounded border px-2 py-1 dark:bg-neutral-900" placeholder="Amount ₦" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="flex-1 rounded border px-2 py-1 dark:bg-neutral-900" placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <button className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            disabled={busy || !bl || amount === ""} onClick={create}>Record</button>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
