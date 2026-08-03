import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { activeProjectId } from "@/lib/activeProject";
import { PageHeader } from "@/components/PageHeader";
import { SalesManager } from "@/components/SalesManager";

const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();

type Sale = {
  sale_id: string; party_name: string; party_role: string; plan_type: string;
  total_amount: string; paid: string; outstanding: string; building_id: string | null;
};

export default async function SalesPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const { data: projects } = await supabase.from("projects").select("id,name").is("archived_at", null).order("name");
  const projectId = activeProjectId(searchParams, projects ?? []);

  const [{ data: sales }, { data: buildings }, { data: clients }] = await Promise.all([
    supabase.from("sale_payment_summary").select("*").eq("project_id", projectId),
    supabase.from("buildings").select("id,code").eq("project_id", projectId).is("archived_at", null).order("code"),
    supabase.from("clients").select("id,full_name,email,phone").is("archived_at", null).order("full_name"),
  ]);

  const rows = (sales ?? []) as Sale[];
  const codeOf = new Map((buildings ?? []).map((b) => [b.id, b.code]));
  const buyers = rows.filter((r) => r.party_role !== "partner");
  const partners = rows.filter((r) => r.party_role === "partner");

  const Table = ({ title, list }: { title: string; list: Sale[] }) => (
    <section className="card p-0 overflow-hidden">
      <h2 className="px-5 pt-5 text-sm font-semibold text-white">{title}</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="table-base min-w-[680px]">
          <thead><tr><th>Party</th><th>Scope</th><th className="text-right">Price</th><th className="text-right">Paid</th><th className="text-right">Outstanding</th><th className="text-right">Open</th></tr></thead>
          <tbody>
            {list.map((s) => {
              const pct = Number(s.total_amount) > 0 ? Math.round((Number(s.paid) / Number(s.total_amount)) * 100) : 0;
              return (
                <tr key={s.sale_id}>
                  <td className="font-medium text-white">{s.party_name}</td>
                  <td className="text-[#8b95a7]">{s.building_id ? (codeOf.get(s.building_id) ?? "house") : "whole project"}</td>
                  <td className="text-right font-mono">{naira(Number(s.total_amount))}</td>
                  <td className="text-right font-mono text-emerald-300">{naira(Number(s.paid))} <span className="text-[#5b6473]">({pct}%)</span></td>
                  <td className="text-right font-mono">{naira(Number(s.outstanding))}</td>
                  <td className="text-right"><Link href={`/sales/${s.sale_id}`} className="btn btn-ghost px-2.5 py-1 text-xs">Open</Link></td>
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={6} className="py-5 text-center text-[#8b95a7]">None yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Sales & payments" subtitle="Buyers and partners, their price, and what they've paid against the schedule."
        info={{
          what: "A sale ties a party to a price on a payment plan. Buyers buy a house and pay as milestones are reached; partners (master developers) invest in the whole project on a time-phased plan. Paid vs outstanding is tracked per tranche.",
          steps: [
            "Add a sale: pick Buyer (a house) or Partner (whole project), the price, and the plan seeds automatically.",
            "Open a sale to see its schedule — which tranche is due now and what's paid.",
            "Record each payment; the schedule fills in order (waterfall).",
          ],
        }} />
      <Table title="Buyers" list={buyers} />
      <Table title="Partners / master developers" list={partners} />
      <SalesManager orgId={orgId} projectId={projectId} buildings={buildings ?? []} clients={clients ?? []} />
    </div>
  );
}
