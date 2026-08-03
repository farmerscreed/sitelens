import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { PageHeader } from "@/components/PageHeader";
import { ClientsPanel } from "@/components/ClientsPanel";

const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();

type Row = {
  client_id: string; full_name: string; email: string | null; phone: string | null;
  kind: string | null; sale_count: number; houses: number;
  contract_value: string; paid: string; outstanding: string;
  due_now: string; next_due_label: string | null; overdue: boolean;
};

// The client directory: everyone who bought (or invested), sorted so the people
// who owe money now are at the top — collections at a glance.
export default async function ClientsPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const [{ data: rows }, { data: unlinked }] = await Promise.all([
    supabase.from("client_summary").select("*")
      .order("due_now", { ascending: false }).order("outstanding", { ascending: false }),
    supabase.from("sales").select("id,party_name,party_email,party_phone")
      .is("client_id", null).is("archived_at", null).order("created_at"),
  ]);

  const clients = (rows ?? []) as Row[];
  const dueTotal = clients.reduce((a, c) => a + Number(c.due_now), 0);
  const kindLabel = (k: string | null) =>
    k === "both" ? "buyer + partner" : k === "partner" ? "partner" : k === "buyer" ? "buyer" : "no sales yet";

  return (
    <div className="space-y-6">
      <PageHeader title="Clients" subtitle="Everyone who bought or invested — what they've paid and what's due now."
        info={{
          what: "One row per client (a buyer or a partner). Their houses, total contract value, what they've paid, and — most importantly — what is due right now: tranches whose milestone has been reached (or whose month has arrived) but haven't been paid. Overdue clients sort to the top.",
          steps: [
            "Clients appear here automatically when you record their sale.",
            "Open a client to see their houses, payment schedules, and portal link.",
            "The 'due now' column is your collections list — start calls from the top.",
          ],
        }} />

      {dueTotal > 0 && (
        <section className="card border-accent-500/25 bg-accent-500/[0.04]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="stat-label">Due now across all clients</div>
              <div className="mt-1 font-mono text-2xl font-semibold text-accent-300">{naira(dueTotal)}</div>
            </div>
            <span className="text-xs text-[#8b95a7]">{clients.filter((c) => c.overdue).length} client(s) have a tranche that is due and unpaid.</span>
          </div>
        </section>
      )}

      <section className="card p-0 overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-white">Directory</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base min-w-[860px]">
            <thead><tr><th>Client</th><th>Role</th><th className="text-right">Houses</th><th className="text-right">Contract</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th><th className="text-right">Due now</th><th className="text-right">Open</th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.client_id}>
                  <td className="font-medium text-white">
                    {c.full_name}
                    <div className="text-[10px] text-[#5b6473]">{c.email ?? c.phone ?? ""}</div>
                  </td>
                  <td className="text-[#8b95a7]">{kindLabel(c.kind)}</td>
                  <td className="text-right font-mono">{c.houses}</td>
                  <td className="text-right font-mono">{naira(Number(c.contract_value))}</td>
                  <td className="text-right font-mono text-emerald-300">{naira(Number(c.paid))}</td>
                  <td className="text-right font-mono">{naira(Number(c.outstanding))}</td>
                  <td className="text-right">
                    {c.overdue
                      ? <span className="badge badge-accent font-mono">{naira(Number(c.due_now))}{c.next_due_label ? ` · ${c.next_due_label}` : ""}</span>
                      : <span className="text-xs text-[#5b6473]">—</span>}
                  </td>
                  <td className="text-right"><Link href={`/clients/${c.client_id}`} className="btn btn-ghost px-2.5 py-1 text-xs">Open</Link></td>
                </tr>
              ))}
              {clients.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-[#8b95a7]">No clients yet — record a sale, or add one below.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <ClientsPanel orgId={orgId} unlinked={(unlinked ?? []) as { id: string; party_name: string; party_email: string | null; party_phone: string | null }[]} />
    </div>
  );
}
