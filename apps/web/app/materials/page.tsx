import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { LogTxnForm } from "@/components/LogTxnForm";
import { PageHeader } from "@/components/PageHeader";
import { ProjectPicker } from "@/components/ProjectPicker";
import { IconAlert } from "@/components/icons";

// Materials: per-project running balances (maintained by the DB under lock, never
// recomputed on read) + reorder alerts + log IN/OUT. All writes via fn_log_material_txn.
export default async function MaterialsPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const { data: projects } = await supabase.from("projects").select("id,name").order("name");
  const projectId = searchParams.project ?? projects?.[0]?.id ?? "";

  const [{ data: balances }, { data: materials }, { data: buildings }, { data: reorder }] = await Promise.all([
    supabase.from("material_balances").select("material_id,balance,updated_at").eq("project_id", projectId),
    supabase.from("materials_catalog").select("id,name,unit,reorder_level").order("name"),
    supabase.from("buildings").select("id,code").eq("project_id", projectId).order("code"),
    supabase.rpc("fn_reorder_advice", { p_project: projectId }),
  ]);
  type Advice = { material_name: string; remaining: number; in_stock: number; order_qty: number };
  const toOrder = ((reorder as Advice[]) ?? []).filter((r) => Number(r.order_qty) > 0);

  const mat = new Map((materials ?? []).map((m) => [m.id, m]));
  const rows = (balances ?? []).map((b) => ({ ...b, m: mat.get(b.material_id) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Materials" subtitle="Running balances maintained by the database under lock — never recomputed on read.">
        <ProjectPicker projects={projects ?? []} value={projectId} />
      </PageHeader>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Material</th>
                <th className="text-right">Balance</th>
                <th className="text-right">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const low = r.m?.reorder_level != null && Number(r.balance) < Number(r.m.reorder_level);
                return (
                  <tr key={r.material_id}>
                    <td className="font-medium text-white">{r.m?.name ?? r.material_id}</td>
                    <td className="text-right font-mono">{Number(r.balance).toLocaleString()} <span className="text-[#8b95a7]">{r.m?.unit}</span></td>
                    <td className="text-right">{low && <span className="badge badge-accent"><IconAlert className="h-3.5 w-3.5" />reorder</span>}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-[#8b95a7]">No stock yet — log a delivery below.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {toOrder.length > 0 && (
        <section className="card border-accent-500/25 bg-accent-500/[0.04]">
          <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-accent-200">
            <IconAlert className="h-4 w-4" /> BOQ-aware reorder advice
            <span className="badge badge-accent">proposal</span>
          </h2>
          <p className="mb-3 text-xs text-[#8b95a7]">Remaining requirement (recipe − consumed) minus current stock. A proposal — you decide.</p>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Material</th><th className="text-right">Remaining need</th><th className="text-right">In stock</th><th className="text-right">Order</th></tr></thead>
              <tbody>
                {toOrder.map((r, k) => (
                  <tr key={k}>
                    <td className="font-medium text-white">{r.material_name}</td>
                    <td className="text-right font-mono">{Number(r.remaining).toLocaleString()}</td>
                    <td className="text-right font-mono">{Number(r.in_stock).toLocaleString()}</td>
                    <td className="text-right font-mono font-semibold text-accent-300">{Number(r.order_qty).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <LogTxnForm projectId={projectId} materials={materials ?? []} buildings={buildings ?? []} />
    </div>
  );
}
