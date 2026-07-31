import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { RecipeEditor } from "@/components/RecipeEditor";
import { BulkKindAccept } from "@/components/BulkKindAccept";
import { AssemblyProposals } from "@/components/AssemblyProposals";
import { IconAlert } from "@/components/icons";

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
// Simple words for builders: no jargon on the page.
const KIND_LABEL: Record<string, string> = {
  material_supply: "supply", composite: "mixed on site", labour: "labour",
  plant: "plant", provisional: "provisional", fitting: "fitting", other: "other",
};
const kindBadge = (k: string) =>
  k === "composite" ? "badge-blue"
  : k === "material_supply" ? "badge-green"
  : k === "labour" || k === "plant" ? "badge-accent"
  : "badge-muted";

// The recipe is a TIMELESS DOCUMENT: what one building takes, priced live.
// Money lives on each building (its budget photo) — never frozen here.
export default async function RecipeDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const typeId = params.id;
  const [
    { data: type }, { data: stages }, { data: items }, { data: costs }, { data: materials },
    { data: workItems }, { data: takeoff }, { data: assemblies }, { data: priceRows },
  ] = await Promise.all([
    supabase.from("building_types").select("id,name,category,version").eq("id", typeId).single(),
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", typeId).order("sequence"),
    supabase.from("type_boq_items").select("id,stage_id,material_id,quantity,unit").eq("building_type_id", typeId),
    supabase.from("type_stage_costs").select("id,stage_id,category,amount").eq("building_type_id", typeId),
    supabase.from("materials_catalog").select("id,name,unit").order("name"),
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

  // Two totals only: the QS's document (frozen at import) and today's cost.
  const boqDocTotal = wi.filter((r) => r.boq_amount != null).reduce((a, r) => a + Number(r.boq_amount), 0);
  const estTotal = wi.filter((r) => r.est_cost != null).reduce((a, r) => a + Number(r.est_cost), 0);
  const buildUpTotal = wi.filter((r) => r.est_source === "build_up").reduce((a, r) => a + Number(r.est_cost), 0);
  const buildUpPct = estTotal > 0 ? Math.round((buildUpTotal / estTotal) * 100) : 0;
  const noPriceCount = wi.filter((r) => r.est_source == null).length;

  const byElement = new Map<string, WorkRow[]>();
  for (const r of wi) {
    const el = r.element_name ?? "Ungrouped";
    if (!byElement.has(el)) byElement.set(el, []);
    byElement.get(el)!.push(r);
  }

  // Shopping list: take-off aggregated to material in stock units.
  const takeoffAgg = new Map<string, number>();
  for (const t of (takeoff ?? []) as TakeoffRow[])
    takeoffAgg.set(t.material_id, (takeoffAgg.get(t.material_id) ?? 0) + Number(t.qty_required));
  const takeoffRows = [...takeoffAgg.entries()]
    .map(([material_id, qty]) => ({ material_id, qty, m: matOf(material_id) }))
    .sort((a, b) => (a.m?.name ?? "").localeCompare(b.m?.name ?? ""));

  // Finish-setup work: mix candidates + lines still typed 'other'.
  const proposalCandidates = wi
    .filter((r) => (r.kind === "composite" || r.kind === "other") && r.assembly_id == null && r.boq_rate != null)
    .map((r) => ({
      id: r.id, description: r.description, mix_ratio: null,
      boq_rate: Number(r.boq_rate), unit: r.unit,
      context: [r.element_name, r.section_name].filter(Boolean).join(" · ") || null,
    }));
  const otherRows = wi.filter((r) => r.kind === "other");
  const setupIncomplete = proposalCandidates.length > 0 || noPriceCount > 0 || otherRows.length > 0;

  return (
    <div className="space-y-6">
      {/* Header — the document and its two numbers. */}
      <section className="card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-white">{type.name}</h1>
            <p className="mt-1 text-sm text-[#8b95a7]">{type.category ?? "—"} · version {type.version}</p>
          </div>
          {wi.length > 0 && (
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-right">
              <div>
                <div className="stat-label">QS document total (as at import)</div>
                <div className="mt-1 font-mono text-xl font-semibold text-[#8b95a7]">{ngn(boqDocTotal)}</div>
              </div>
              <div>
                <div className="stat-label">Cost to start today</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-white">{ngn(estTotal)}</div>
                <div className="mt-0.5 text-xs text-emerald-300">{buildUpPct}% your prices</div>
              </div>
            </div>
          )}
        </div>
        {wi.length > 0 && setupIncomplete && (
          <p className="mt-4 flex items-start gap-1.5 rounded-xl border border-accent-500/25 bg-accent-500/[0.06] px-3.5 py-2.5 text-sm text-accent-300">
            <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Some lines aren&apos;t fully set up ({proposalCandidates.length > 0 ? `${proposalCandidates.length} need a mix` : ""}
              {proposalCandidates.length > 0 && (otherRows.length > 0 || noPriceCount > 0) ? " · " : ""}
              {otherRows.length > 0 ? `${otherRows.length} need a type` : ""}
              {otherRows.length > 0 && noPriceCount > 0 ? " · " : ""}
              {noPriceCount > 0 ? `${noPriceCount} have no price` : ""}) —{" "}
              <a href="#finish-setup" className="underline hover:text-white">finish setup below</a> to price more of the bill yourself.
            </span>
          </p>
        )}
      </section>

      {wi.length > 0 && (
        <>
          {/* Finish setup — collapsed; the only place the machinery shows. */}
          {setupIncomplete && (
            <details id="finish-setup" className="card p-0 overflow-hidden">
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-white">
                Finish setup
                <span className="ml-2 font-normal text-[#8b95a7]">— attach mixes and fix line types so more of the bill uses your prices</span>
              </summary>
              <div className="space-y-5 border-t border-white/[0.06] p-5">
                {otherRows.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-white">Lines that need a type</h3>
                    <BulkKindAccept
                      items={otherRows.map((r) => ({
                        id: r.id, description: r.description,
                        element_name: r.element_name, section_name: r.section_name,
                      }))}
                    />
                  </div>
                )}
                {proposalCandidates.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-white">Mixes for lines done on site</h3>
                    <AssemblyProposals
                      orgId={orgId}
                      mode="recipe"
                      candidates={proposalCandidates}
                      materials={materials ?? []}
                      assemblies={assemblies ?? []}
                      prices={prices}
                    />
                  </div>
                )}
                {noPriceCount > 0 && (
                  <p className="text-xs text-[#8b95a7]">
                    {noPriceCount} line(s) have no price from any side — give their materials a price on the Price list, or attach a mix.
                  </p>
                )}
              </div>
            </details>
          )}

          {/* The Bill — the document itself, line by line. */}
          <section className="card p-0 overflow-hidden">
            <div className="px-5 pt-5 pb-1">
              <h2 className="text-sm font-semibold text-white">The Bill</h2>
              <p className="mt-0.5 text-xs text-[#8b95a7]">
                Every line of the bill with the QS&apos;s rate and today&apos;s estimate side by side — green means it&apos;s priced from your own mixes and price list.
              </p>
            </div>
            {[...byElement.entries()].map(([element, rows]) => (
              <div key={element} className="border-t border-white/[0.06]">
                <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]">{element}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="table-base min-w-[880px]">
                    <thead>
                      <tr><th className="min-w-[20rem]">Description</th><th>Kind</th><th className="text-right">Qty</th><th className="text-right">QS rate</th><th className="text-right">Estimate</th><th className="text-right">vs QS</th></tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const est = r.est_cost == null ? null : Number(r.est_cost);
                        const boq = r.boq_amount == null ? null : Number(r.boq_amount);
                        // Variance is only meaningful once the estimate is your own price.
                        const diff = r.est_source === "build_up" && est != null && boq != null ? est - boq : null;
                        return (
                          <tr key={r.id}>
                            <td className="text-white">
                              <div className="max-w-[26rem] whitespace-normal text-[13px] leading-snug">{r.description}</div>
                              {r.boq_ref && <div className="mt-0.5 text-[10px] text-[#5b6473]">{r.boq_ref}</div>}
                            </td>
                            <td><span className={`badge ${kindBadge(r.kind)}`}>{KIND_LABEL[r.kind] ?? r.kind.replace("_", " ")}</span></td>
                            <td className="text-right font-mono">
                              {r.quantity != null ? Number(r.quantity).toLocaleString("en-NG") : "—"} <span className="text-[#8b95a7]">{r.unit ?? ""}</span>
                            </td>
                            <td className="text-right font-mono text-[#8b95a7]">{r.boq_rate != null ? ngn(Number(r.boq_rate)) : "—"}</td>
                            <td className="text-right">
                              {est != null ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <span className={`badge ${r.est_source === "build_up" ? "badge-green" : "badge-accent"}`}>
                                    {r.est_source === "build_up" ? "your price" : "QS price"}
                                  </span>
                                  <span className="font-mono text-white">{ngn(est)}</span>
                                </span>
                              ) : (
                                <span className="text-xs text-[#5b6473]">no price yet</span>
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

          {/* Shopping list — everything one building needs, in the units you buy. */}
          <section className="card p-0 overflow-hidden">
            <div className="px-5 pt-5">
              <h2 className="text-sm font-semibold text-white">Shopping list</h2>
              <p className="mt-0.5 text-xs text-[#8b95a7]">
                Everything one building needs — supply lines plus every mix broken into raw materials (waste and formwork reuse included), in the units you buy.
              </p>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Material</th><th className="text-right">Qty needed</th></tr></thead>
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
                    <tr><td colSpan={2} className="py-5 text-center text-[#8b95a7]">Nothing convertible yet — attach mixes and add unit conversions.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <RecipeEditor
        type={type}
        stages={stages ?? []}
        items={items ?? []}
        costs={costs ?? []}
        materials={materials ?? []}
      />
    </div>
  );
}
