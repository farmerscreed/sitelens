import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { RecipeEditor } from "@/components/RecipeEditor";
import { WorkItemKindSelect } from "@/components/WorkItemKindSelect";
import { AssemblyProposals } from "@/components/AssemblyProposals";

type WorkRow = {
  id: string; stage_id: string | null; element_name: string | null; section_name: string | null;
  boq_ref: string | null;
  description: string; quantity: string | null; unit: string | null; kind: string;
  assembly_id: string | null; boq_rate: string | null; is_priced: boolean;
  unit_cost_live: string | null; cost_live: string | null; boq_amount: string | null;
  est_cost: string | null; est_source: "build_up" | "boq_rate" | null;
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
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const typeId = params.id;
  const [
    { data: type }, { data: stages }, { data: items }, { data: costs }, { data: materials },
    { data: cost }, { data: workItems }, { data: takeoff }, { data: assemblies }, { data: priceRows },
  ] = await Promise.all([
    supabase.from("building_types").select("id,name,category,version").eq("id", typeId).single(),
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", typeId).order("sequence"),
    supabase.from("type_boq_items").select("id,stage_id,material_id,quantity,unit").eq("building_type_id", typeId),
    supabase.from("type_stage_costs").select("id,stage_id,category,amount").eq("building_type_id", typeId),
    supabase.from("materials_catalog").select("id,name,unit").order("name"),
    supabase.rpc("fn_type_cost", { p_type: typeId }).single(),
    supabase.from("work_item_cost")
      .select("id,stage_id,element_name,section_name,boq_ref,description,quantity,unit,kind,assembly_id,boq_rate,is_priced,unit_cost_live,cost_live,boq_amount,est_cost,est_source")
      .eq("building_type_id", typeId).order("element_name"),
    supabase.from("type_material_takeoff").select("material_id,qty_required").eq("building_type_id", typeId),
    supabase.from("assemblies").select("id,name,unit,ratio").order("name"),
    supabase.from("material_prices").select("material_id,unit_price,effective_from")
      .lte("effective_from", new Date().toISOString().slice(0, 10))
      .order("effective_from", { ascending: false }),
  ]);

  if (!type) redirect("/recipes");

  const wi = (workItems ?? []) as WorkRow[];
  const matOf = (id: string) => (materials ?? []).find((m) => m.id === id);

  // Latest price per material (rows arrive newest-first).
  const prices: Record<string, number> = {};
  for (const p of priceRows ?? [])
    if (prices[p.material_id] === undefined) prices[p.material_id] = Number(p.unit_price);

  // Blended estimate: live build-up where one exists, the QS's own rate as the
  // labelled fallback — complete from day one, converging to the true build-up.
  const boqPricedTotal = wi.filter((r) => r.is_priced && r.boq_amount != null)
    .reduce((a, r) => a + Number(r.boq_amount), 0);
  const estTotal = wi.filter((r) => r.est_cost != null).reduce((a, r) => a + Number(r.est_cost), 0);
  const buildUpTotal = wi.filter((r) => r.est_source === "build_up").reduce((a, r) => a + Number(r.est_cost), 0);
  const qsTotal = wi.filter((r) => r.est_source === "boq_rate").reduce((a, r) => a + Number(r.est_cost), 0);
  const noPriceCount = wi.filter((r) => r.est_source == null).length;
  const buildUpPct = estTotal > 0 ? Math.round((buildUpTotal / estTotal) * 100) : 0;
  const qsPct = estTotal > 0 ? Math.round((qsTotal / estTotal) * 100) : 0;

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

  // Assembly-proposal candidates: composite/other items with a QS rate but no
  // build-up yet — attaching an assembly moves them from 'QS rate' to 'build-up'.
  const proposalCandidates = wi
    .filter((r) => (r.kind === "composite" || r.kind === "other") && r.assembly_id == null && r.boq_rate != null)
    .map((r) => ({
      id: r.id, description: r.description, mix_ratio: null,
      boq_rate: Number(r.boq_rate), unit: r.unit,
      // Element/section headings often carry the grade the line itself omits.
      context: [r.element_name, r.section_name].filter(Boolean).join(" · ") || null,
    }));

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
                Blended estimate — your own build-up wherever one exists, the QS&apos;s rate as a labelled fallback (Rule 4: computed live, never stored).
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-3 px-5 py-4">
              <div>
                <div className="stat-label">Estimate</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-white">{ngn(estTotal)}</div>
              </div>
              <div className="pb-0.5 text-sm">
                <span className="text-emerald-300">{buildUpPct}% from your own build-up</span>
                <span className="text-[#5b6473]"> · </span>
                <span className="text-accent-300">{qsPct}% still on QS rates</span>
                <span className="text-[#5b6473]"> · </span>
                <span className={noPriceCount > 0 ? "text-red-300" : "text-[#8b95a7]"}>{noPriceCount} item{noPriceCount === 1 ? "" : "s"} with no price at all</span>
              </div>
              <div className="ml-auto text-right">
                <div className="stat-label">BOQ priced total (reference)</div>
                <div className="mt-1 font-mono text-lg font-semibold text-[#8b95a7]">{ngn(boqPricedTotal)}</div>
              </div>
            </div>
            {[...byElement.entries()].map(([element, rows]) => (
              <div key={element} className="border-t border-white/[0.06]">
                <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]">{element}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="table-base min-w-[880px]">
                    <thead>
                      <tr><th className="min-w-[20rem]">Description</th><th>Kind</th><th className="text-right">Qty</th><th className="text-right">BOQ rate</th><th className="text-right">Estimate</th><th className="text-right">vs BOQ</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const est = r.est_cost == null ? null : Number(r.est_cost);
                        const boq = r.boq_amount == null ? null : Number(r.boq_amount);
                        // Variance is only meaningful once the estimate is our own build-up.
                        const diff = r.est_source === "build_up" && est != null && boq != null ? est - boq : null;
                        return (
                          <tr key={r.id}>
                            <td className="text-white">
                              <div className="max-w-[26rem] whitespace-normal text-[13px] leading-snug">{r.description}</div>
                              {r.boq_ref && <div className="mt-0.5 text-[10px] text-[#5b6473]">{r.boq_ref}</div>}
                            </td>
                            <td>
                              {r.kind === "other"
                                ? <WorkItemKindSelect id={r.id} kind={r.kind} />
                                : <span className={`badge ${kindBadge(r.kind)}`}>{r.kind.replace("_", " ")}</span>}
                            </td>
                            <td className="text-right font-mono">
                              {r.quantity != null ? Number(r.quantity).toLocaleString("en-NG") : "—"} <span className="text-[#8b95a7]">{r.unit ?? ""}</span>
                            </td>
                            <td className="text-right font-mono text-[#8b95a7]">{r.boq_rate != null ? ngn(Number(r.boq_rate)) : "—"}</td>
                            <td className="text-right">
                              {est != null ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className={`badge ${r.est_source === "build_up" ? "badge-green" : "badge-accent"}`}>
                                    {r.est_source === "build_up" ? "build-up" : "QS rate"}
                                  </span>
                                  <span className="font-mono text-white">{ngn(est)}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-[#5b6473]">not yet costable</span>
                              )}
                            </td>
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

          {/* Assembly proposals — the normal flow: composite/other items still on a
              QS rate get an assembly proposed (or an existing one matched). */}
          {proposalCandidates.length > 0 && (
            <section className="card">
              <h2 className="text-sm font-semibold text-white">Assembly proposals</h2>
              <p className="mt-1 text-xs text-[#8b95a7]">
                {proposalCandidates.length} item(s) are still costed on the QS&apos;s all-in rate. Attach an assembly and they switch to your own build-up.
              </p>
              <AssemblyProposals
                orgId={orgId}
                mode="recipe"
                candidates={proposalCandidates}
                materials={materials ?? []}
                assemblies={assemblies ?? []}
                prices={prices}
              />
            </section>
          )}

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
