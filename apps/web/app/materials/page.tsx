import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { LogTxnForm } from "@/components/LogTxnForm";
import { PageHeader } from "@/components/PageHeader";
import { ProjectPicker } from "@/components/ProjectPicker";
import { IconAlert, IconBox, IconLayers } from "@/components/icons";

// Materials & inventory. On-hand balances are maintained by the DB under lock (never
// recomputed on read). The store lists the WHOLE catalog so you always see what you track,
// even at zero. Usage-vs-BOQ compares actual consumption (OUT) to the design quantity.
// All writes go through fn_log_material_txn (Rule 1); cost = qty × current price (Rule 4).
export default async function MaterialsPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const today = new Date().toISOString().slice(0, 10);
  const { data: projects } = await supabase.from("projects").select("id,name").order("name");
  const projectId = searchParams.project ?? projects?.[0]?.id ?? "";

  const [
    { data: balances }, { data: materials }, { data: buildings },
    { data: reorder }, { data: prices }, { data: boqItems }, { data: outTxns },
  ] = await Promise.all([
    supabase.from("material_balances").select("material_id,balance").eq("project_id", projectId),
    supabase.from("materials_catalog").select("id,name,unit,reorder_level").is("archived_at", null).order("name"),
    supabase.from("buildings").select("id,code,building_type_id").eq("project_id", projectId).order("code"),
    supabase.rpc("fn_reorder_advice", { p_project: projectId }),
    supabase.from("material_prices").select("material_id,unit_price,effective_from").lte("effective_from", today).order("effective_from", { ascending: false }),
    supabase.from("type_boq_items").select("building_type_id,material_id,quantity"),
    supabase.from("material_transactions").select("material_id,quantity,building_id").eq("project_id", projectId).eq("type", "OUT").is("voided_at", null),
  ]);

  // --- Derive maps -----------------------------------------------------------
  const onHand = new Map((balances ?? []).map((b) => [b.material_id, Number(b.balance)]));
  const price = new Map<string, number>();
  for (const p of prices ?? []) if (!price.has(p.material_id)) price.set(p.material_id, Number(p.unit_price));

  // BOQ (planned) per material = for every building, its type's recipe quantity for that material.
  const boqByType = new Map<string, Map<string, number>>(); // type_id -> material_id -> qty
  for (const it of boqItems ?? []) {
    if (!boqByType.has(it.building_type_id)) boqByType.set(it.building_type_id, new Map());
    const m = boqByType.get(it.building_type_id)!;
    m.set(it.material_id, (m.get(it.material_id) ?? 0) + Number(it.quantity));
  }
  const planned = new Map<string, number>();
  for (const b of buildings ?? []) {
    const recipe = b.building_type_id ? boqByType.get(b.building_type_id) : undefined;
    if (!recipe) continue;
    for (const [mid, q] of recipe) planned.set(mid, (planned.get(mid) ?? 0) + q);
  }
  const used = new Map<string, number>();
  for (const t of outTxns ?? []) used.set(t.material_id, (used.get(t.material_id) ?? 0) + Number(t.quantity));

  const rows = (materials ?? []).map((m) => {
    const stock = onHand.get(m.id) ?? 0;
    const p = price.get(m.id) ?? 0;
    return {
      ...m,
      stock,
      price: p,
      value: stock * p,
      low: m.reorder_level != null && stock < Number(m.reorder_level),
      planned: planned.get(m.id) ?? 0,
      used: used.get(m.id) ?? 0,
    };
  });
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const lowCount = rows.filter((r) => r.low).length;
  const hasBoq = rows.some((r) => r.planned > 0);

  type Advice = { material_name: string; remaining: number; in_stock: number; order_qty: number };
  const toOrder = ((reorder as Advice[]) ?? []).filter((r) => Number(r.order_qty) > 0);
  const naira = (n: number) => "₦" + Math.round(n).toLocaleString();

  return (
    <div className="space-y-6">
      <PageHeader title="Materials & inventory" subtitle="What's in store, what it's worth, and how usage compares to the BOQ. On-hand is the running sum of every delivery minus every issue — never a typed number.">
        <ProjectPicker projects={projects ?? []} value={projectId} />
      </PageHeader>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="stat"><div className="flex items-center justify-between"><span className="stat-label">Stock value</span><IconBox className="h-5 w-5 text-accent-400/80" /></div><div className="stat-value">{naira(totalValue)}</div></div>
        <div className="stat"><div className="flex items-center justify-between"><span className="stat-label">Materials tracked</span><IconLayers className="h-5 w-5 text-accent-400/80" /></div><div className="stat-value">{rows.length}</div></div>
        <div className="stat"><div className="flex items-center justify-between"><span className="stat-label">Below reorder</span><IconAlert className="h-5 w-5 text-accent-400/80" /></div><div className={`stat-value ${lowCount ? "text-accent-300" : ""}`}>{lowCount}</div></div>
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
              <tr>
                <th>Material</th>
                <th className="text-right">On hand</th>
                <th className="text-right">Current price</th>
                <th className="text-right">Value</th>
                <th className="text-right">Status</th>
              </tr>
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

      {/* Usage vs BOQ — inventory ↔ construction */}
      <section className="card p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold text-white">Usage vs plan (BOQ)</h2>
          <p className="mt-1 text-xs text-[#8b95a7]">
            Planned = the recipe quantity across all {(buildings ?? []).length} building(s) on this project.
            Used = everything issued OUT to those buildings. Over 100% means you&apos;ve consumed more than the design allows.
          </p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Material</th>
                <th className="text-right">Planned (BOQ)</th>
                <th className="text-right">Used</th>
                <th className="text-right">Remaining</th>
                <th className="w-40">Consumption</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.planned > 0 || r.used > 0).map((r) => {
                const pct = r.planned > 0 ? (r.used / r.planned) * 100 : (r.used > 0 ? 999 : 0);
                const over = r.used > r.planned && r.planned > 0;
                return (
                  <tr key={r.id}>
                    <td className="font-medium text-white">{r.name}</td>
                    <td className="text-right font-mono">{r.planned.toLocaleString()} <span className="text-[#8b95a7]">{r.unit}</span></td>
                    <td className="text-right font-mono">{r.used.toLocaleString()}</td>
                    <td className={`text-right font-mono ${over ? "text-red-300" : ""}`}>{(r.planned - r.used).toLocaleString()}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                          <div className={`h-full rounded-full ${over ? "bg-red-400" : "bg-accent-sheen"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                        </div>
                        <span className={`w-10 text-right text-xs font-medium ${over ? "text-red-300" : "text-[#8b95a7]"}`}>{r.planned > 0 ? Math.round(pct) + "%" : "—"}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!hasBoq && (used.size === 0) && (
                <tr><td colSpan={5} className="py-6 text-center text-[#8b95a7]">No BOQ or usage yet. Assign a recipe to buildings on the Board, then log OUT transactions below.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Reorder advice */}
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
