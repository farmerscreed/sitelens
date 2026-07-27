import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { LogTxnForm } from "@/components/LogTxnForm";

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

  const [{ data: balances }, { data: materials }, { data: buildings }] = await Promise.all([
    supabase.from("material_balances").select("material_id,balance,updated_at").eq("project_id", projectId),
    supabase.from("materials_catalog").select("id,name,unit,reorder_level").order("name"),
    supabase.from("buildings").select("id,code").eq("project_id", projectId).order("code"),
  ]);

  const mat = new Map((materials ?? []).map((m) => [m.id, m]));
  const rows = (balances ?? []).map((b) => ({ ...b, m: mat.get(b.material_id) }));

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Materials</h1>
        <form>
          <select name="project" defaultValue={projectId}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()}>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </form>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
            <th className="py-1">Material</th><th className="text-right">Balance</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const low = r.m?.reorder_level != null && Number(r.balance) < Number(r.m.reorder_level);
            return (
              <tr key={r.material_id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1">{r.m?.name ?? r.material_id}</td>
                <td className="text-right font-mono">{Number(r.balance).toLocaleString()} {r.m?.unit}</td>
                <td className="text-right">{low && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">reorder</span>}</td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={3} className="py-2 text-neutral-500">No stock yet — log a delivery below.</td></tr>}
        </tbody>
      </table>

      <LogTxnForm projectId={projectId} materials={materials ?? []} buildings={buildings ?? []} />
    </main>
  );
}
