import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { RecipeEditor } from "@/components/RecipeEditor";
import { BulkKindAccept } from "@/components/BulkKindAccept";
import { PriceMissingPanel } from "@/components/PriceMissingPanel";
import { AssemblyProposals } from "@/components/AssemblyProposals";
import { ScopeToggle } from "@/components/ScopeToggle";
import { TakeoffCheckCard, type CheckViewRow } from "@/components/TakeoffCheckCard";
import { TypeCoverUpload } from "@/components/TypeCoverUpload";
import { IconAlert } from "@/components/icons";

type WorkRow = {
  id: string; stage_id: string | null; element_name: string | null; section_name: string | null;
  boq_ref: string | null;
  description: string; quantity: string | null; unit: string | null; kind: string;
  assembly_id: string | null; material_id: string | null; boq_rate: string | null; is_priced: boolean;
  in_scope: boolean;
  unit_cost_live: string | null; cost_live: string | null; boq_amount: string | null;
  est_cost: string | null; est_source: "build_up" | "boq_rate" | null;
};
type CompRow = {
  assembly_id: string; material_id: string; qty_per_unit: string; unit: string;
  waste_factor: string; component_kind: string; reuse_count: string | null;
};
type ConvRow = { material_id: string; from_unit: string; to_unit: string; factor: string };

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
    { data: workItems }, { data: comps }, { data: convs }, { data: assemblies }, { data: priceRows },
    { data: checkRows },
  ] = await Promise.all([
    supabase.from("building_types").select("id,name,category,version,cover_key").eq("id", typeId).single(),
    supabase.from("type_stages").select("id,name,sequence,expected_days").eq("building_type_id", typeId).order("sequence"),
    supabase.from("type_boq_items").select("id,stage_id,material_id,quantity,unit").eq("building_type_id", typeId),
    supabase.from("type_stage_costs").select("id,stage_id,category,amount").eq("building_type_id", typeId),
    supabase.from("materials_catalog").select("id,name,unit").order("name"),
    supabase.from("work_item_cost")
      .select("id,stage_id,element_name,section_name,boq_ref,description,quantity,unit,kind,assembly_id,material_id,boq_rate,is_priced,in_scope,unit_cost_live,cost_live,boq_amount,est_cost,est_source")
      .eq("building_type_id", typeId).order("element_name"),
    supabase.from("assembly_components")
      .select("assembly_id,material_id,qty_per_unit,unit,waste_factor,component_kind,reuse_count"),
    supabase.from("material_conversions").select("material_id,from_unit,to_unit,factor"),
    supabase.from("assemblies").select("id,name,unit,ratio").order("name"),
    supabase.from("material_prices").select("material_id,unit_price,effective_from")
      .lte("effective_from", new Date().toISOString().slice(0, 10))
      .order("effective_from", { ascending: false }),
    supabase.from("type_takeoff_check")
      .select("id,source_sheet,section,label,unit,stated_qty,stated_amount,material_id,stated_qty_converted,computed_qty,variance_pct")
      .eq("building_type_id", typeId).order("source_sheet").order("label"),
  ]);

  if (!type) redirect("/recipes");

  // The structure's face: signed 15-min URL for the cover render, when set.
  let coverUrl: string | null = null;
  if (type.cover_key) {
    const { data: signed } = await supabase.storage.from("type-covers").createSignedUrl(type.cover_key, 900);
    coverUrl = signed?.signedUrl ?? null;
  }

  const wi = (workItems ?? []) as WorkRow[];
  const matOf = (id: string) => (materials ?? []).find((m) => m.id === id);

  // CONTRACT SCOPE: the bill decided (priced = in, unpriced = by-others). All
  // numbers, panels and lists below run over the CONTRACT only; excluded lines
  // live in their own collapsed list with a one-tap way back in.
  const inScope = wi.filter((r) => r.in_scope);
  const excluded = wi.filter((r) => !r.in_scope);
  const excludedEst = excluded.filter((r) => r.est_cost != null).reduce((a, r) => a + Number(r.est_cost), 0);

  // Latest price per material (rows arrive newest-first).
  const prices: Record<string, number> = {};
  for (const p of priceRows ?? [])
    if (prices[p.material_id] === undefined) prices[p.material_id] = Number(p.unit_price);

  // Two totals only: the QS's document (frozen at import) and today's cost.
  const boqDocTotal = inScope.filter((r) => r.boq_amount != null).reduce((a, r) => a + Number(r.boq_amount), 0);
  const estTotal = inScope.filter((r) => r.est_cost != null).reduce((a, r) => a + Number(r.est_cost), 0);
  const buildUpTotal = inScope.filter((r) => r.est_source === "build_up").reduce((a, r) => a + Number(r.est_cost), 0);
  const buildUpPct = estTotal > 0 ? Math.round((buildUpTotal / estTotal) * 100) : 0;
  const noPriceCount = inScope.filter((r) => r.est_source == null).length;

  const byElement = new Map<string, WorkRow[]>();
  for (const r of inScope) {
    const el = r.element_name ?? "Ungrouped";
    if (!byElement.has(el)) byElement.set(el, []);
    byElement.get(el)!.push(r);
  }

  // Shopping list: contract-only take-off computed here (the DB view is not
  // scope-aware) — same math as type_material_takeoff: direct supply + mixes
  // exploded (waste / formwork reuse), converted to stock units, unconvertible
  // quantities skipped rather than guessed.
  const nu = (u: string | null | undefined) => (u ?? "").replace(/\s/g, "").toLowerCase();
  const convMap = new Map<string, number>();
  for (const c of (convs ?? []) as ConvRow[])
    convMap.set(`${c.material_id}|${nu(c.from_unit)}|${nu(c.to_unit)}`, Number(c.factor));
  const compsByAssembly = new Map<string, CompRow[]>();
  for (const c of (comps ?? []) as CompRow[]) {
    if (!compsByAssembly.has(c.assembly_id)) compsByAssembly.set(c.assembly_id, []);
    compsByAssembly.get(c.assembly_id)!.push(c);
  }
  const toStock = (materialId: string, qty: number, from: string | null): number | null => {
    const m = matOf(materialId);
    if (!m) return null;
    if (!from || nu(from) === nu(m.unit)) return qty;
    const f = convMap.get(`${materialId}|${nu(from)}|${nu(m.unit)}`);
    return f != null ? qty * f : null;
  };
  const takeoffAgg = new Map<string, number>();
  const addQty = (mid: string, q: number | null) => {
    if (q != null && q > 0) takeoffAgg.set(mid, (takeoffAgg.get(mid) ?? 0) + q);
  };
  for (const r of inScope) {
    const qty = r.quantity != null ? Number(r.quantity) : null;
    if (qty == null) continue;
    if (r.kind === "material_supply" && r.material_id) {
      addQty(r.material_id, toStock(r.material_id, qty, r.unit));
    } else if (r.kind === "composite" && r.assembly_id) {
      for (const c of compsByAssembly.get(r.assembly_id) ?? []) {
        const eff = c.component_kind === "reusable"
          ? Number(c.qty_per_unit) / Math.max(Number(c.reuse_count ?? 1) || 1, 1)
          : Number(c.qty_per_unit) * Number(c.waste_factor);
        addQty(c.material_id, toStock(c.material_id, qty * eff, c.unit));
      }
    }
  }
  const takeoffRows = [...takeoffAgg.entries()]
    .map(([material_id, qty]) => ({ material_id, qty, m: matOf(material_id) }))
    .sort((a, b) => (a.m?.name ?? "").localeCompare(b.m?.name ?? ""));

  // Finish-setup work (contract only): mix candidates + lines still typed 'other'.
  const proposalCandidates = inScope
    .filter((r) => (r.kind === "composite" || r.kind === "other") && r.assembly_id == null && r.boq_rate != null)
    .map((r) => ({
      id: r.id, description: r.description, mix_ratio: null,
      boq_rate: Number(r.boq_rate), unit: r.unit,
      context: [r.element_name, r.section_name].filter(Boolean).join(" · ") || null,
    }));
  const otherRows = inScope.filter((r) => r.kind === "other");
  // Composite lines without a mix whose words may say steel/formwork — the old
  // rule order filed them under concrete; BulkKindAccept offers the re-type.
  const misTypeCandidates = inScope.filter((r) => r.kind === "composite" && r.assembly_id == null);
  const typeFixRows = [...otherRows, ...misTypeCandidates];
  // Lines no estimate can reach — the give-them-a-price list.
  const noPriceRows = inScope.filter((r) => r.est_source == null);
  const setupIncomplete = proposalCandidates.length > 0 || noPriceCount > 0 || otherRows.length > 0;

  return (
    <div className="space-y-6">
      {/* Header — the document and its two numbers. */}
      <section className="card overflow-hidden p-0">
        {coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt={type.name} className="h-56 w-full object-cover" />
        )}
        <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-white">{type.name}</h1>
              {excluded.length > 0 && <span className="badge badge-muted">Semi-finished (as billed)</span>}
            </div>
            <p className="mt-1 text-sm text-[#8b95a7]">{type.category ?? "—"} · version {type.version}</p>
            <div className="mt-2">
              <TypeCoverUpload orgId={orgId} typeId={type.id} hasCover={!!type.cover_key} />
            </div>
          </div>
          {wi.length > 0 && (
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-right">
              <div>
                <div className="stat-label">QS document total (as at import)</div>
                <div className="mt-1 font-mono text-xl font-semibold text-[#8b95a7]">{ngn(boqDocTotal)}</div>
              </div>
              <div className="max-w-[20rem]">
                <div className="stat-label">Cost to start today</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-white">{ngn(estTotal)}</div>
                {noPriceCount === 0 ? (
                  <div className="mt-0.5 text-xs text-emerald-300">✓ Fully priced — every contract line has a number</div>
                ) : (
                  <div className="mt-0.5 text-xs text-accent-300">{noPriceCount} contract line{noPriceCount === 1 ? "" : "s"} still need{noPriceCount === 1 ? "s" : ""} a price</div>
                )}
                <div className="mt-1 text-[11px] leading-snug text-[#8b95a7]">
                  Your own prices cover {buildUpPct}% of the value — the rest uses the QS&apos;s rates until you replace them (grows as you confirm mixes and agreed rates)
                </div>
              </div>
            </div>
          )}
        </div>
        {excluded.length > 0 && (
          <p className="mt-3 text-sm text-[#8b95a7]">
            Excluded from contract (by others): {excluded.length} line{excluded.length === 1 ? "" : "s"}
            {excludedEst > 0 && <> ≈ {ngn(excludedEst)} at your prices</>} —{" "}
            <a href="#excluded-lines" className="underline hover:text-white">view</a>
          </p>
        )}
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
        </div>
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
                {typeFixRows.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-white">Lines that need a type</h3>
                    <BulkKindAccept
                      items={typeFixRows.map((r) => ({
                        id: r.id, kind: r.kind, description: r.description,
                        element_name: r.element_name, section_name: r.section_name,
                      }))}
                    />
                  </div>
                )}
                {noPriceRows.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-white">Give these a price</h3>
                    <PriceMissingPanel
                      orgId={orgId}
                      materials={materials ?? []}
                      items={noPriceRows.map((r) => ({
                        id: r.id, kind: r.kind, description: r.description,
                        element_name: r.element_name,
                        quantity: r.quantity != null ? Number(r.quantity) : null,
                        unit: r.unit, material_id: r.material_id,
                      }))}
                      pricedLines={inScope.filter((r) => r.boq_rate != null && Number(r.boq_rate) > 0).map((r) => ({
                        description: r.description, boq_rate: Number(r.boq_rate),
                        unit: r.unit, element_name: r.element_name,
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
                              <div className="mt-0.5 flex items-center gap-2">
                                {r.boq_ref && <span className="text-[10px] text-[#5b6473]">{r.boq_ref}</span>}
                                <ScopeToggle id={r.id} inScope={true} />
                              </div>
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

          {/* Excluded (by others) — out of every number above; one tap brings a line back. */}
          {excluded.length > 0 && (
            <details id="excluded-lines" className="card p-0 overflow-hidden">
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-white">
                Excluded from contract (by others) — {excluded.length} line{excluded.length === 1 ? "" : "s"}
                <span className="ml-2 font-normal text-[#8b95a7]">— the bill left these unpriced, so they&apos;re not in your numbers; add one to a single house as a variation from its page</span>
              </summary>
              <div className="overflow-x-auto border-t border-white/[0.06]">
                <table className="table-base min-w-[720px]">
                  <thead>
                    <tr><th className="min-w-[22rem]">Description</th><th className="text-right">Qty</th><th className="text-right">At your prices</th><th /></tr>
                  </thead>
                  <tbody>
                    {excluded.map((r) => (
                      <tr key={r.id}>
                        <td className="text-white">
                          <div className="max-w-[28rem] whitespace-normal text-[13px] leading-snug">{r.description}</div>
                          <div className="mt-0.5 text-[10px] text-[#5b6473]">{r.element_name ?? "—"}{r.boq_ref ? ` · ${r.boq_ref}` : ""}</div>
                        </td>
                        <td className="text-right font-mono">
                          {r.quantity != null ? Number(r.quantity).toLocaleString("en-NG") : "—"} <span className="text-[#8b95a7]">{r.unit ?? ""}</span>
                        </td>
                        <td className="text-right font-mono">
                          {r.est_cost != null ? ngn(Number(r.est_cost)) : <span className="text-xs text-[#5b6473]">no price yet</span>}
                        </td>
                        <td className="text-right"><ScopeToggle id={r.id} inScope={false} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </>
      )}

      {/* The workbook grades the recipe: its own schedule/totals vs the live
          take-off. Visible even before bills are confirmed — captured check
          values shouldn't hide while the take-off is still empty. */}
      {(checkRows ?? []).length > 0 && (
        <TakeoffCheckCard
          rows={(checkRows ?? []) as CheckViewRow[]}
          materials={materials ?? []}
          estTotal={estTotal}
        />
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
