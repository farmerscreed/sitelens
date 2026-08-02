"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconAlert } from "@/components/icons";

type Payment = { id: string; amount: string; paid_on: string; method: string | null; note: string | null };
const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();

// Record / void payments against a sale (money path: fn_record_payment idempotent,
// fn_void_payment). The schedule (waterfall) is rendered read-only on the page.
export function PaymentPanel({ saleId, payments }: { saleId: string; payments: Payment[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");

  async function record() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_record_payment", {
      p_id: crypto.randomUUID(), p_sale: saleId, p_amount: Number(amount),
      p_idempotency_key: crypto.randomUUID(), p_method: method.trim() || null, p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setAmount(""); setMethod(""); setNote(""); router.refresh();
  }
  async function voidPay(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_void_payment", { p_payment: id, p_reason: "voided from console" });
    setBusy(false);
    if (error) setErr(error.message); else router.refresh();
  }

  return (
    <section className="card">
      <h2 className="text-sm font-semibold text-white">Payments received</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Date</th><th>Method</th><th>Note</th><th className="text-right">Amount</th><th className="text-right">Void</th></tr></thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id}>
                <td className="text-[#c7cedb]">{p.paid_on}</td>
                <td className="text-[#8b95a7]">{p.method ?? "—"}</td>
                <td className="text-[#8b95a7]">{p.note ?? "—"}</td>
                <td className="text-right font-mono text-white">{naira(Number(p.amount))}</td>
                <td className="text-right"><button className="btn btn-danger px-2 py-1 text-xs" disabled={busy} onClick={() => voidPay(p.id)}>Void</button></td>
              </tr>
            ))}
            {payments.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-[#8b95a7]">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="sm:w-40"><label className="label">Amount (₦)</label>
          <input type="number" min="0" className="input" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="sm:w-36"><label className="label">Method</label>
          <input className="input" placeholder="transfer" value={method} onChange={(e) => setMethod(e.target.value)} /></div>
        <div className="flex-1"><label className="label">Note <span className="text-[#5b6473]">(optional)</span></label>
          <input className="input" placeholder="—" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <button className="btn btn-primary shrink-0" disabled={busy || amount === ""} onClick={record}><IconPlus className="h-4 w-4" />Record</button>
      </div>
      {err && <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </section>
  );
}
