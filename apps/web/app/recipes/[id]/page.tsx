import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecipeEditor } from "@/components/RecipeEditor";

type WorkRow = {
  id: string; stage_id: string | null; element_name: string | null; boq_ref: string | null;
  description: string; quantity: string | null; unit: string | null; kind: string;
  boq_rate: string | null; is_priced: boolean;
  unit_cost_live: string | null; cost_live: string | null; boq_amount: string | null;
};
type TakeoffRow = { material_id: string; qty_required: string };

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const kindBadge = (k: string) =>
  k === "composite" ? "badge-blue"
  : k === "material_supply" ? "badge-green"
  : k === "labour" || k === "plant" ? "badge-accent"
  : "badge-muted";

export default async function RecipeDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const typeId = params.id;
  const [{ data: type }, { data: stages }, { data: items }, { data: costs }, { data: materials }, { data: cost }, { data: workItems }, { data: takeoff }] =
    await Promise.all([
      supabase.from("building_types").select("id,name,category,version").eq("id", typeId).single(),
      supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", typeId).order("sequence"),
      supabase.from("type_boq_items").select("id,stage_id,material_id,quantity,unit").eq("building_type_id", typeId),
      supabase.from("type_stage_costs").select("id,stage_id,category,amount").eq("building_type_id", typeId),
      supabase.from("materials_catalog").select("id,name,unit").order("name"),
      supabase.rpc("fn_type_cost", { p_type: typeId }).single(),
      supabase.from("work_item_cost")
        .select("id,stage_id,element_name,boq_ref,description,quantity,unit,kind,boq_rate,is_priced,unit_cost_live,cost_live,boq_amount")
        .eq("building_type_id", typeId).order("element_name"),
      supabase.from("type_material_takeoff").select("material_id,qty_required").eq("building_type_id", typeId),
    ]);

  if (!type) redirect("/recipes");

  const wi = (workItems ?? []) as WorkRow[];
  const matOf = (id: string) => (materials ?? []).find((m) => m.id === id);

  // True-cost headline numbers (Rule 4: cost_live is computed by the DB, never stored).
  const boqPricedTotal = wi.filter((r) => r.is_priced && r.boq_amount != null)
    .reduce((a, r) => a + Number(r.boq_amount), 0);
  const unpricedCount = wi.filter((r) => !r.is_priced).length;
  const liveTotal = wi.filter((r) => r.cost_live != null).reduce((a, r) => a + Number(r.cost_live), 0);
  const notCostable = wi.filter((r) => r.cost_live == null).length;

  const byElement = new Map<string, WorkRow[]>();
  for (const r of wi) {
    const el = r.element_name ?? "Ungrouped";
    if (!byElement.has(el)) byElement.set(el, []);
    byElement.get(el)!.push(r);
  }

  // Take-off arrives per stage — aggregate to material for the summary table.
  const takeoffAgg = new Map<string, number>();
  for (const t of (takeoff ?? []) as TakeoffRow[])
    takeoffAgg.set(t.material_id, (takeoffAgg.get(t.material_id) ?? 0) + Number(t.qty_required));
  const takeoffRows = [...takeoffAgg.entries()]
    .map(([material_id, qty]) => ({ material_id, qty, m: matOf(material_id) }))
    .sort((a, b) => (a.m?.name ?? "").localeCompare(b.m?.name ?? ""));

  return (
    <div className="space-y-6">
      <RecipeEditor
        type={type}
        stages={stages ?? []}
        items={items ?? []}
        costs={costs ?? []}
        materials={materials ?? []}
        cost={(cost as { materials_cost: number; nonmaterial_cost: number; total_cost: number } | null) ?? { materials_cost: 0, nonmaterial_cost: 0, total_cost: 0 }}
      />

      {/* True cost from work items — hidden until a BOQ has been confirmed as work items. */}
      {wi.length > 0 && (
        <>
          <section className="card p-0 overflow-hidden">
            <div className="px-5 pt-5">
              <h2 className="text-sm font-semibold text-white">True cost (work items)</h2>
              <p className="mt-0.5 text-xs text-[#8b95a7]">
                The bill&apos;s rate is reference only — live cost = today&apos;s prices through each assembly (Rule 4).
              </p>
            </div>
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
              <div>
                <div className="stat-label">BOQ priced total</div>
                <div className="mt-1 font-mono text-xl font-semibold text-white">{ngn(boqPricedTotal)}</div>
              </div>
              <div>
                <div className="stat-label">Unpriced items</div>
                <div className={`mt-1 font-mono text-xl font-semibold ${unpricedCount > 0 ? "text-accent-300" : "text-white"}`}>{unpricedCount}</div>
              </div>
              <div>
                <div className="stat-label">Live estimate</div>
                <div className="mt-1 font-mono text-xl font-semibold text-white">{ngn(liveTotal)}</div>
                {notCostable > 0 && (
                  <div className="mt-0.5 text-xs text-[#8b95a7]">{notCostable} row(s) not yet costable (no price / assembly / conversion)</div>
                )}
              </div>
            </div>
            {[...byElement.entries()].map(([element, rows]) => (
              <div key={element} className="border-t border-white/[0.06]">
                <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]">{element}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="table-base min-w-[880px]">
                    <thead>
                      <tr><th className="min-w-[20rem]">Description</th><th>Kind</th><th className="text-right">Qty</th><th className="text-right">BOQ rate</th><th className="text-right">Live unit cost</th><th className="text-right">Live cost</th><th className="text-right">vs BOQ</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const live = r.cost_live == null ? null : Number(r.cost_live);
                        const boq = r.boq_amount == null ? null : Number(r.boq_amount);
                        const diff = live != null && boq != null ? live - boq : null;
                        return (
                          <tr key={r.id}>
                            <td className="text-white">
                              <div className="max-w-[26rem] whitespace-normal text-[13px] leading-snug">{r.description}</div>
                              {r.boq_ref && <div className="mt-0.5 text-[10px] text-[#5b6473]">{r.boq_ref}</div>}
                            </td>
                            <td><span className={`badge ${kindBadge(r.kind)}`}>{r.kind.replace("_", " ")}</span></td>
                            <td className="text-right font-mono">
                              {r.quantity != null ? Number(r.quantity).toLocaleString("en-NG") : "—"} <span className="text-[#8b95a7]">{r.unit ?? ""}</span>
                            </td>
                            <td className="text-right font-mono text-[#8b95a7]">{r.boq_rate != null ? ngn(Number(r.boq_rate)) : "—"}</td>
                            <td className="text-right font-mono">{r.unit_cost_live != null ? ngn(Number(r.unit_cost_live)) : <span className="text-[#5b6473]">not costable</span>}</td>
                            <td className="text-right font-mono text-white">{live != null ? ngn(live) : "—"}</td>
                            <td className={`text-right font-mono ${diff == null ? "text-[#5b6473]" : diff > 0 ? "text-red-300" : "text-emerald-300"}`}>
                              {diff == null ? "—" : `${diff > 0 ? "+" : ""}${ngn(diff)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>

          <section className="card p-0 overflow-hidden">
            <div className="px-5 pt-5">
              <h2 className="text-sm font-semibold text-white">Material take-off</h2>
              <p className="mt-0.5 text-xs text-[#8b95a7]">
                Raw materials one building needs — direct supply lines plus every assembly exploded (waste and formwork reuse applied), in stock units.
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Material</th><th className="text-right">Qty required</th></tr></thead>
                <tbody>
                  {takeoffRows.map((t) => (
                    <tr key={t.material_id}>
                      <td className="text-white">{t.m?.name ?? t.material_id}</td>
                      <td className="text-right font-mono">
                        {t.qty.toLocaleString("en-NG", { maximumFractionDigits: 2 })} <span className="text-[#8b95a7]">{t.m?.unit ?? ""}</span>
                      </td>
                    </tr>
                  ))}
                  {takeoffRows.length === 0 && (
                    <tr><td colSpan={2} className="py-5 text-center text-[#8b95a7]">Nothing convertible yet — map materials/assemblies and add unit conversions.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
