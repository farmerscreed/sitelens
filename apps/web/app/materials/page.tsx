import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LogTxnForm } from "@/components/LogTxnForm";
import { PageHeader } from "@/components/PageHeader";
import { activeProjectId } from "@/lib/activeProject";
import { IconAlert, IconBox, IconLayers } from "@/components/icons";

// Materials & inventory. The store is a PROJECT pool (on-hand = Σ IN − Σ OUT, held under
// lock, never typed). Procurement is planned at the PROJECT/BATCH level (what to buy);
// per-building variance (did THIS house over-use?) lives on the building page — a project
// average would hide it. "Planned" everywhere is the true-cost take-off (mixes included).
// All writes go through fn_log_material_txn (Rule 1); cost = qty × current price (Rule 4).
export default async function MaterialsPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const today = new Date().toISOString().slice(0, 10);
  const { data: projects } = await supabase.from("projects").select("id,name").is("archived_at", null).order("name");
  const projectId = activeProjectId(searchParams, projects ?? []);

  const [
    { data: balances }, { data: materials }, { data: buildings },
    { data: reorder }, { data: prices }, { data: batchPlan }, { data: batches },
  ] = await Promise.all([
    supabase.from("material_balances").select("material_id,balance").eq("project_id", projectId),
    supabase.from("materials_catalog").select("id,name,unit,reorder_level").is("archived_at", null).order("name"),
    supabase.from("buildings").select("id,code,building_type_id").eq("project_id", projectId).is("archived_at", null).order("code"),
    supabase.rpc("fn_reorder_advice", { p_project: projectId }),
    supabase.from("material_prices").select("material_id,unit_price,effective_from").lte("effective_from", today).order("effective_from", { ascending: false }),
    supabase.from("batch_material_plan").select("batch_id,material_id,planned,consumed,remaining,in_stock").eq("project_id", projectId),
    supabase.from("batches").select("id,name").eq("project_id", projectId).order("sequence"),
  ]);

  const onHand = new Map((balances ?? []).map((b) => [b.material_id, Number(b.balance)]));
  const price = new Map<string, number>();
  for (const p of prices ?? []) if (!price.has(p.material_id)) price.set(p.material_id, Number(p.unit_price));
  const matOf = new Map((materials ?? []).map((m) => [m.id, m]));

  const rows = (materials ?? []).map((m) => {
    const stock = onHand.get(m.id) ?? 0;
    const p = price.get(m.id) ?? 0;
    return { ...m, stock, price: p, value: stock * p, low: m.reorder_level != null && stock < Number(m.reorder_level) };
  });
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  // Procurement plan (project) — take-off sourced. required = full recipe over live buildings.
  type Advice = { material_id: string; material_name: string; required: number; consumed: number; in_stock: number; remaining: number; order_qty: number };
  const plan = (((reorder as Advice[]) ?? []).map((r) => ({
    ...r, required: Number(r.required), consumed: Number(r.consumed),
    in_stock: Number(r.in_stock), remaining: Number(r.remaining), order_qty: Number(r.order_qty),
  }))).sort((a, b) => a.material_name.localeCompare(b.material_name));
  const toOrderCount = plan.filter((p) => p.order_qty > 0).length;

  // Procurement by batch (each batch's combined recipe vs consumed vs project stock).
  const batchName = new Map((batches ?? []).map((b) => [b.id, b.name]));
  const byBatch = new Map<string, { name: string; rows: { material_id: string; planned: number; consumed: number; remaining: number; in_stock: number }[] }>();
  for (const r of batchPlan ?? []) {
    const key = r.batch_id as string;
    if (!byBatch.has(key)) byBatch.set(key, { name: (batchName.get(key) as string) ?? "Batch", rows: [] });
    byBatch.get(key)!.rows.push({
      material_id: r.material_id, planned: Number(r.planned), consumed: Number(r.consumed),
      remaining: Number(r.remaining), in_stock: Number(r.in_stock),
    });
  }
  const batchGroups = [...byBatch.values()].map((g) => ({ ...g, rows: g.rows.sort((a, b) => (matOf.get(a.material_id)?.name ?? "").localeCompare(matOf.get(b.material_id)?.name ?? "")) }));

  const naira = (n: number) => "₦" + Math.round(n).toLocaleString();
  const unitOf = (id: string) => matOf.get(id)?.unit ?? "";
  const nameOf = (id: string) => matOf.get(id)?.name ?? id;

  return (
    <div className="space-y-6">
      <PageHeader title="Materials & inventory" subtitle="What's in store, what it's worth, and what to buy next. On-hand is the running sum of every delivery minus every issue — never a typed number."
        info={{
          what: "This page is the STORE for a project: on-hand stock (Σ deliveries − Σ issues, held under lock) and the procurement plan (what the project still needs to buy). Whether a single house over-used a material lives on that building's page — a project average would hide it.",
          steps: [
            "Log a delivery: set the toggle to IN, pick the material, quantity and the price you paid, then Log.",
            "Log usage: switch to OUT, pick the material, quantity and the building it went to.",
            "Read the Procurement plan for what to still buy (planned − consumed − stock); follow the highlighted 'to order' rows.",
            "Open a building to see that house's usage-vs-plan and any overrun.",
          ],
        }} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="stat"><div className="flex items-center justify-between"><span className="stat-label">Stock value</span><IconBox className="h-5 w-5 text-accent-400/80" /></div><div className="stat-value">{naira(totalValue)}</div></div>
        <div className="stat"><div className="flex items-center justify-between"><span className="stat-label">Materials tracked</span><IconLayers className="h-5 w-5 text-accent-400/80" /></div><div className="stat-value">{rows.length}</div></div>
        <div className="stat"><div className="flex items-center justify-between"><span className="stat-label">To order</span><IconAlert className="h-5 w-5 text-accent-400/80" /></div><div className={`stat-value ${toOrderCount ? "text-accent-300" : ""}`}>{toOrderCount}</div></div>
      </div>

      {/* Store — full catalog, always visible */}
      <section className="card p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 className="text-sm font-semibold text-white">In store</h2>
          <span className="text-xs text-[#8b95a7]">on-hand × current price = value</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Material</th><th className="text-right">On hand</th><th className="text-right">Current price</th><th className="text-right">Value</th><th className="text-right">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-white">{r.name}</td>
                  <td className="text-right font-mono">{r.stock.toLocaleString()} <span className="text-[#8b95a7]">{r.unit}</span></td>
                  <td className="text-right font-mono text-[#8b95a7]">{r.price ? naira(r.price) : "—"}</td>
                  <td className="text-right font-mono">{r.value ? naira(r.value) : "—"}</td>
                  <td className="text-right">
                    {r.stock === 0 ? <span className="badge badge-muted">empty</span>
                      : r.low ? <span className="badge badge-accent"><IconAlert className="h-3.5 w-3.5" />reorder</span>
                      : <span className="badge badge-green">ok</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-[#8b95a7]">No materials in this org yet — add them in the price list.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Procurement plan (project) — take-off sourced */}
      <section className="card p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold text-white">Procurement plan</h2>
          <p className="mt-1 text-xs text-[#8b95a7]">
            Planned = the recipe need across all {(buildings ?? []).length} live building(s) on this project (mixes broken to raw materials).
            To order = planned − consumed − stock. A proposal — you decide.
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base min-w-[720px]">
            <thead>
              <tr><th>Material</th><th className="text-right">Planned</th><th className="text-right">Consumed</th><th className="text-right">In stock</th><th className="text-right">Remaining</th><th className="text-right">To order</th></tr>
            </thead>
            <tbody>
              {plan.map((r) => (
                <tr key={r.material_id} className={r.order_qty > 0 ? "bg-accent-500/[0.04]" : ""}>
                  <td className="font-medium text-white">{r.material_name}</td>
                  <td className="text-right font-mono">{r.required.toLocaleString()} <span className="text-[#8b95a7]">{unitOf(r.material_id)}</span></td>
                  <td className="text-right font-mono text-[#8b95a7]">{r.consumed.toLocaleString()}</td>
                  <td className="text-right font-mono text-[#8b95a7]">{r.in_stock.toLocaleString()}</td>
                  <td className="text-right font-mono">{r.remaining.toLocaleString()}</td>
                  <td className={`text-right font-mono font-semibold ${r.order_qty > 0 ? "text-accent-300" : "text-[#5b6473]"}`}>{r.order_qty.toLocaleString()}</td>
                </tr>
              ))}
              {plan.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-[#8b95a7]">No recipe on this project&apos;s buildings yet. Stamp buildings from a recipe on the Board.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* Procurement by batch (only when buildings are grouped into batches) */}
      {batchGroups.length > 0 && (
        <section className="card p-0 overflow-hidden">
          <div className="px-5 pt-5">
            <h2 className="text-sm font-semibold text-white">By batch</h2>
            <p className="mt-1 text-xs text-[#8b95a7]">Each batch&apos;s combined recipe vs what it has consumed. Stock is the shared project pool.</p>
          </div>
          <div className="space-y-4 p-5">
            {batchGroups.map((g, i) => (
              <div key={i}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-accent-300">{g.name}</h3>
                <div className="overflow-x-auto">
                  <table className="table-base min-w-[560px]">
                    <thead><tr><th>Material</th><th className="text-right">Planned</th><th className="text-right">Consumed</th><th className="text-right">Remaining</th><th className="text-right">In stock</th></tr></thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.material_id}>
                          <td className="font-medium text-white">{nameOf(r.material_id)}</td>
                          <td className="text-right font-mono">{r.planned.toLocaleString()} <span className="text-[#8b95a7]">{unitOf(r.material_id)}</span></td>
                          <td className="text-right font-mono text-[#8b95a7]">{r.consumed.toLocaleString()}</td>
                          <td className="text-right font-mono">{r.remaining.toLocaleString()}</td>
                          <td className="text-right font-mono text-[#8b95a7]">{r.in_stock.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <LogTxnForm projectId={projectId} materials={materials ?? []} buildings={buildings ?? []} />
    </div>
  );
}
