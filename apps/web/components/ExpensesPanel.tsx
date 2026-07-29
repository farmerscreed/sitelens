"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconAlert } from "@/components/icons";

type Expense = { id: string; amount: number; status: string; description: string | null; paid_to: string | null; budget_line_id: string; created_at: string };
type BudgetLine = { id: string; name: string; cost_code: string };

const badgeClass: Record<string, string> = {
  pending: "badge-accent", approved: "badge-green", rejected: "badge-red", voided: "badge-muted",
};

export function ExpensesPanel({ projectId, expenses, budgetLines }: { projectId: string; expenses: Expense[]; budgetLines: BudgetLine[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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

  const total = expenses.filter((e) => e.status !== "voided").reduce((s, e) => s + Number(e.amount), 0);

  return (
    <div className="space-y-5">
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-sm font-semibold text-white">Recorded expenses</h2>
          <span className="text-xs text-[#8b95a7]">Committed: <span className="font-mono text-[#c7cedb]">₦{total.toLocaleString()}</span></span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Amount</th><th>Description</th><th>Status</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap font-mono text-white">₦{Number(e.amount).toLocaleString()}</td>
                  <td>{e.description ?? <span className="text-[#5b6473]">—</span>}</td>
                  <td><span className={`badge ${badgeClass[e.status] ?? "badge-muted"}`}>{e.status}</span></td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {e.status === "pending" && (
                        <button className="btn btn-ghost px-2.5 py-1 text-xs" disabled={busy}
                          onClick={() => call("fn_approve_expense", { p_expense: e.id })}>Approve</button>
                      )}
                      {e.status !== "voided" && (
                        <button className="btn btn-danger px-2.5 py-1 text-xs" disabled={busy}
                          onClick={() => call("fn_void_expense", { p_expense: e.id, p_reason: "voided from console" })}>Void</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[#8b95a7]">No expenses yet — record one below.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <section className="card max-w-2xl">
        <h2 className="text-sm font-semibold text-white">Record an expense</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Budget line</label>
            <select className="select" value={bl} onChange={(e) => setBl(e.target.value)}>
              {budgetLines.map((l) => <option key={l.id} value={l.id}>{l.cost_code} · {l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Amount (₦)</label>
            <input type="number" min="0" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" placeholder="What was it for?" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary mt-4" disabled={busy || !bl || amount === ""} onClick={create}>
          <IconPlus className="h-4 w-4" />Record expense
        </button>
        {err && <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
      </section>
    </div>
  );
}
