import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PaymentPanel } from "@/components/PaymentPanel";
import { IconChevron } from "@/components/icons";

const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();

type Tr = {
  seq: number; label: string; percent: string; amount: string;
  trigger_milestone: string | null; due_month: number | null;
  pay_status: string; is_due: boolean;
};
type Payment = { id: string; amount: string; paid_on: string; method: string | null; note: string | null };

export default async function SaleDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: sale } = await supabase.from("sale_payment_summary").select("*").eq("sale_id", params.id).maybeSingle();
  if (!sale) redirect("/sales");

  const [{ data: schedule }, { data: payments }] = await Promise.all([
    supabase.from("payment_schedule").select("*").eq("sale_id", params.id).order("seq"),
    supabase.from("payments").select("id,amount,paid_on,method,note").eq("sale_id", params.id).is("voided_at", null).order("paid_on", { ascending: false }),
  ]);
  const bldCode = sale.building_id
    ? (await supabase.from("buildings").select("code").eq("id", sale.building_id).maybeSingle()).data?.code
    : null;

  const rows = (schedule ?? []) as Tr[];
  const pct = Number(sale.total_amount) > 0 ? Math.round((Number(sale.paid) / Number(sale.total_amount)) * 100) : 0;
  const statusBadge = (s: string) => (s === "paid" ? "badge-green" : s === "part" ? "badge-accent" : "badge-muted");

  return (
    <div className="space-y-6">
      <Link href="/sales" className="inline-flex items-center gap-1 text-sm text-[#8b95a7] hover:text-white">
        <IconChevron className="h-4 w-4 rotate-90" />Back to sales
      </Link>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{sale.party_name}</h1>
        <p className="mt-0.5 text-sm text-[#8b95a7]">
          {sale.party_role === "partner" ? "Partner / master developer · whole project" : `Buyer · ${bldCode ?? "house"}`} ·{" "}
          {sale.plan_type === "time_phased" ? "time-phased plan" : "milestone plan"}
        </p>
      </header>

      <section className="card">
        <div className="grid gap-4 sm:grid-cols-4">
          <div><div className="stat-label">Price</div><div className="mt-1 font-mono text-xl font-semibold text-white">{naira(Number(sale.total_amount))}</div></div>
          <div><div className="stat-label">Paid</div><div className="mt-1 font-mono text-xl font-semibold text-emerald-300">{naira(Number(sale.paid))}</div></div>
          <div><div className="stat-label">Outstanding</div><div className="mt-1 font-mono text-xl font-semibold text-white">{naira(Number(sale.outstanding))}</div></div>
          <div><div className="stat-label">% paid</div><div className="mt-1 font-mono text-xl font-semibold text-accent-300">{pct}%</div></div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-accent-sheen" style={{ width: `${pct}%` }} /></div>
      </section>

      <section className="card p-0 overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-white">Payment schedule</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead><tr><th>Tranche</th><th>Trigger</th><th className="text-right">Amount</th><th>Status</th><th className="text-right">Due now?</th></tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.seq}>
                  <td className="font-medium text-white">{t.label} <span className="text-[#5b6473]">({Number(t.percent)}%)</span></td>
                  <td className="text-[#8b95a7]">{t.trigger_milestone ? `at ${t.trigger_milestone}` : t.due_month != null ? `by month ${t.due_month}` : "on booking"}</td>
                  <td className="text-right font-mono">{naira(Number(t.amount))}</td>
                  <td><span className={`badge ${statusBadge(t.pay_status)}`}>{t.pay_status}</span></td>
                  <td className="text-right">{t.is_due ? <span className="badge badge-accent">due</span> : <span className="text-xs text-[#5b6473]">upcoming</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <PaymentPanel saleId={params.id} payments={(payments ?? []) as Payment[]} />
    </div>
  );
}
