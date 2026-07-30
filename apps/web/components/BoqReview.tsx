"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";
import { AssemblyProposals, type ProposalAttachment } from "@/components/AssemblyProposals";

type Row = {
  id: string; raw_text: string; resolved_text: string | null;
  parsed_qty: number | null; parsed_unit: string | null; unit_normalized: string | null;
  parsed_rate: number | null; amount: number | null;
  mapped_material_id: string | null; confidence: number | null; status: string;
  row_kind: string; boq_ref: string | null; section_path: string[] | null;
  is_priced: boolean; is_provisional: boolean;
  suggested_stage_id: string | null; suggested_kind: string | null;
  mix_ratio: string | null; material_guess: string | null; flags: string[] | null;
  row_no: number | null;
};
type Material = { id: string; name: string; unit: string };
type Stage = { id: string; name: string; sequence: number };
type Assembly = { id: string; name: string; unit: string; ratio?: string | null };
type Reconciliation = {
  extracted_total: number; stated_total: number | null; variance_pct: number | null;
  sections: { element: string; extracted: number; stated: number | null; ok: boolean }[];
  flagged_rows: number; item_count: number;
} | null;

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

// Every work-item kind the bill can carry (work_item_kind enum).
const KINDS = ["material_supply", "composite", "labour", "plant", "provisional", "fitting", "other"] as const;

const FLAG_LABEL: Record<string, string> = {
  amount_mismatch: "qty×rate ≠ amount", unknown_unit: "unknown unit",
  missing_qty: "no qty", missing_unit: "no unit", qty_text_coerced: "qty was text",
  possible_duplicate: "possible duplicate", ditto_resolved: "ditto",
  ditto_unresolved: "ditto unresolved", rate_not_applicable: "rate N/A",
};

// One editable "create this material" candidate: unmapped supply/fitting rows,
// grouped by the AI's material guess (or the first 40 chars of the text).
type MatDraft = {
  key: string; on: boolean; name: string; unit: string;
  price: string; priceOn: boolean; hasRate: boolean; row_ids: string[];
};
function buildMatCandidates(items: Row[]): MatDraft[] {
  const map = new Map<string, MatDraft>();
  for (const r of items) {
    if (r.mapped_material_id) continue;
    if (r.suggested_kind !== "material_supply" && r.suggested_kind !== "fitting") continue;
    const text = (r.resolved_text ?? r.raw_text ?? "").trim();
    const label = (r.material_guess ?? text.slice(0, 40)).trim();
    if (!label) continue;
    const key = label.toLowerCase();
    let d = map.get(key);
    if (!d) {
      d = { key, on: true, name: label, unit: r.unit_normalized ?? r.parsed_unit ?? "", price: "", priceOn: true, hasRate: false, row_ids: [] };
      map.set(key, d);
    }
    d.row_ids.push(r.id);
    if (!d.unit && (r.unit_normalized ?? r.parsed_unit)) d.unit = r.unit_normalized ?? r.parsed_unit ?? "";
    // Only a genuine supply rate may prefill a price (§7 guardrail — the server enforces it too).
    if (!d.hasRate && r.suggested_kind === "material_supply" && r.parsed_rate != null) {
      d.hasRate = true; d.price = String(r.parsed_rate);
    }
  }
  return [...map.values()];
}

// Review v2 (BOQ_TRUE_COST_DESIGN §11): reconciliation banner, element groups,
// risk-first highlighting, full descriptions, unpriced scope surfaced. Every row
// stays a proposal until fn_confirm_boq_import_v2 — the only write path into the
// recipe's work items. Composite rows can point at an assembly for live costing.
export function BoqReview({
  importId, orgId, format, status, reconciliation, pricedTotal, unpricedCount, rows, materials, stages, assemblies, prices,
}: {
  importId: string; orgId: string; format: string; status: string;
  reconciliation: Reconciliation; pricedTotal: number | null; unpricedCount: number | null;
  rows: Row[]; materials: Material[]; stages: Stage[]; assemblies: Assembly[];
  prices: Record<string, number>;
}) {
  const router = useRouter();
  const supabase = createClient();
  const items = useMemo(
    () => rows.filter((r) => r.row_kind === "item")
      .sort((a, b) => (a.row_no ?? Number.MAX_SAFE_INTEGER) - (b.row_no ?? Number.MAX_SAFE_INTEGER)),
    [rows],
  );
  // Stage defaults to the extractor's SUGGESTION; otherwise unassigned — the human places it.
  const [state, setState] = useState(
    items.map((r) => ({
      row_id: r.id, include: true,
      kind: r.suggested_kind ?? "other",
      material_id: r.mapped_material_id ?? "",
      assembly_id: "",
      stage_id: r.suggested_stage_id ?? "",
      quantity: r.parsed_qty ?? 0,
      unit: r.unit_normalized ?? r.parsed_unit ?? "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  // "Set up from this bill" — bootstrap stages/materials for a young org.
  const [matDrafts, setMatDrafts] = useState<MatDraft[]>(() => buildMatCandidates(items));
  const [bootMsg, setBootMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const stageBootstrapNeeded = items.some((r) => !r.suggested_stage_id && !!r.section_path?.[0]);
  const patchMat = (i: number, p: Partial<MatDraft>) =>
    setMatDrafts((s) => s.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const matSelected = matDrafts.filter((d) => d.on && d.name.trim() && d.unit.trim());

  // Assembly proposals (third bootstrap step): composite-suggested rows. Confirmed
  // proposals are APPLIED here at confirm time — the new/matched assembly is
  // pre-selected on every row of the group (kind composite + assembly_id).
  const compositeCandidates = useMemo(
    () => items.filter((r) => r.suggested_kind === "composite").map((r) => ({
      id: r.id, description: r.resolved_text ?? r.raw_text,
      mix_ratio: r.mix_ratio, boq_rate: r.parsed_rate,
      unit: r.unit_normalized ?? r.parsed_unit,
      // Section headings often carry the grade the line itself omits.
      context: (r.section_path ?? []).filter(Boolean).join(" · ") || null,
    })),
    [items],
  );
  const [extraAssemblies, setExtraAssemblies] = useState<Assembly[]>([]);
  const allAssemblies = useMemo(
    () => [...assemblies, ...extraAssemblies.filter((e) => !assemblies.some((a) => a.id === e.id))],
    [assemblies, extraAssemblies],
  );
  function applyAssemblyAttachments(atts: ProposalAttachment[]) {
    setExtraAssemblies((s) => [...s, ...atts.map((a) => ({ id: a.assemblyId, name: a.assemblyName, unit: a.assemblyUnit }))]);
    setState((s) => s.map((r) => {
      const att = atts.find((a) => a.itemIds.includes(r.row_id));
      return att ? { ...r, kind: "composite", assembly_id: att.assemblyId } : r;
    }));
  }

  async function bootstrapStages() {
    setBusy(true); setBootMsg(null);
    const { data, error } = await supabase.rpc("fn_bootstrap_stages_from_import", { p_import: importId });
    setBusy(false);
    if (error) setBootMsg({ ok: false, t: error.message });
    else {
      const d = data as { created?: number; assigned?: number } | null;
      setBootMsg({ ok: true, t: `Created ${d?.created ?? 0} stage(s), assigned ${d?.assigned ?? 0} row(s) — reloading…` });
      setTimeout(() => window.location.reload(), 1200);
    }
  }
  async function bootstrapMaterials() {
    setBusy(true); setBootMsg(null);
    const p_selections = matSelected.map((d) => ({
      name: d.name.trim(), unit: d.unit.trim(),
      price: d.hasRate && d.priceOn && d.price !== "" ? Number(d.price) : "",
      row_ids: d.row_ids,
    }));
    const { data, error } = await supabase.rpc("fn_bootstrap_materials_from_import", { p_import: importId, p_selections });
    setBusy(false);
    if (error) setBootMsg({ ok: false, t: error.message });
    else {
      const d = data as { created?: number; priced?: number; rows_mapped?: number } | null;
      setBootMsg({ ok: true, t: `Created ${d?.created ?? 0} material(s), seeded ${d?.priced ?? 0} price(s), mapped ${d?.rows_mapped ?? 0} row(s) — reloading…` });
      setTimeout(() => window.location.reload(), 1200);
    }
  }

  const byId = useMemo(() => new Map(items.map((r, i) => [r.id, i])), [items]);
  const groups = useMemo(() => {
    const g = new Map<string, Row[]>();
    for (const r of items) {
      const el = r.section_path?.[0] ?? "Ungrouped";
      if (!g.has(el)) g.set(el, []);
      g.get(el)!.push(r);
    }
    return [...g.entries()];
  }, [items]);
  const secStats = useMemo(() => {
    const m = new Map<string, { extracted: number; stated: number | null; ok: boolean }>();
    reconciliation?.sections?.forEach((s) => m.set(s.element, s));
    return m;
  }, [reconciliation]);

  function patch(i: number, p: Partial<(typeof state)[number]>) {
    setState((s) => s.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }
  function setGroupInclude(rowsIn: Row[], include: boolean) {
    const ids = new Set(rowsIn.map((r) => r.id));
    setState((s) => s.map((r) => (ids.has(r.row_id) ? { ...r, include } : r)));
  }
  // §7: only material_supply rows with a rate become price PROPOSALS (composite/
  // labour BOQ rates are all-in and never touch the price list). Human accepts on /ai.
  async function proposePrices() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("fn_propose_prices_from_import", { p_import: importId });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else setMsg({ ok: true, t: data > 0 ? `${data} price proposal(s) created — decide on the AI proposals page.` : "No proposable rates (only true supply items with a rate qualify)." });
  }
  // A row is confirmable when included and, only if it's a material supply line,
  // mapped to a material — labour/composite/provisional lines need no material.
  const confirmable = (s: (typeof state)[number]) =>
    s.include && (s.kind !== "material_supply" || !!s.material_id);

  async function confirm() {
    setBusy(true); setMsg(null);
    const p_items = state.filter(confirmable).map((r) => ({
      row_id: r.row_id, stage_id: r.stage_id || null, kind: r.kind,
      material_id: r.material_id || null,
      assembly_id: r.kind === "composite" ? r.assembly_id || null : null,
      quantity: Number(r.quantity), unit: r.unit,
    }));
    const { data, error } = await supabase.rpc("fn_confirm_boq_import_v2", { p_import: importId, p_items });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Confirmed ${data} work item(s) into the recipe.` }); router.refresh(); }
  }

  const rowRisky = (r: Row) => {
    const s = state[byId.get(r.id)!];
    return (r.flags?.length ?? 0) > 0 || (s?.kind === "material_supply" && !s?.material_id);
  };
  const needsAttention = items.filter(rowRisky).length;
  const mappedCount = state.filter(confirmable).length;
  const rec = reconciliation;
  const varianceOk = rec?.variance_pct != null && Math.abs(rec.variance_pct) <= 0.5;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Review BOQ import</h1>
        <p className="mt-1 text-sm text-[#8b95a7]">
          <span className="badge badge-muted mr-2">{format.toUpperCase()}</span>{status} · every row is a proposal —
          map, place, then confirm. Mappings are remembered for next time.
        </p>
      </div>

      {/* Reconciliation banner — the import's trust signal (§5). */}
      {rec && (
        <div className={`rounded-2xl border p-4 text-sm ${varianceOk ? "border-emerald-500/25 bg-emerald-500/[0.06]" : "border-accent-500/30 bg-accent-500/[0.06]"}`}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="font-semibold text-white">{rec.item_count} items extracted</span>
            <span className="text-[#c7cedb]">Σ {ngn(rec.extracted_total)}{rec.stated_total != null && <> vs bill&apos;s {ngn(rec.stated_total)}</>}</span>
            {rec.variance_pct != null && (
              <span className={varianceOk ? "text-emerald-300" : "text-accent-300"}>
                {rec.variance_pct === 0 ? "exact match" : `${rec.variance_pct > 0 ? "+" : ""}${rec.variance_pct}%`}
              </span>
            )}
            <span className="text-[#8b95a7]">{rec.flagged_rows} flagged</span>
            {unpricedCount != null && unpricedCount > 0 && (
              <span className="text-accent-300">{unpricedCount} measured items UNPRICED in the bill</span>
            )}
          </div>
          {unpricedCount != null && unpricedCount > 0 && (
            <p className="mt-1.5 text-xs text-[#8b95a7]">
              The bill&apos;s own total ({ngn(pricedTotal)}) excludes those unpriced items — it is not the full cost to
              finish. Import them anyway; pricing proposals arrive with the true-cost build.
            </p>
          )}
        </div>
      )}
      {needsAttention > 0 && (
        <p className="flex items-center gap-1.5 text-sm text-accent-300">
          <IconAlert className="h-4 w-4" />{needsAttention} row(s) need attention (flagged, or a supply line with no material) — they&apos;re highlighted below.
        </p>
      )}

      {/* Set up from this bill — the bill as the young org's setup tool. Only shown
          while there is something to bootstrap; both writes are SECURITY DEFINER
          RPCs and everything on screen is editable before confirming (Rule 3). */}
      {(stageBootstrapNeeded || matDrafts.length > 0 || compositeCandidates.length > 0) && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Set up from this bill</h2>
          <p className="mt-1 text-xs text-[#8b95a7]">
            Missing stages, catalog materials or assemblies? Create them straight from the bill — check and edit everything below first.
          </p>
          {bootMsg && (
            <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
              bootMsg.ok ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                         : "border-red-500/20 bg-red-500/[0.06] text-red-300"}`}>
              {bootMsg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{bootMsg.t}
            </div>
          )}

          {stageBootstrapNeeded && (
            <div className="mt-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
              <p className="text-sm text-[#c7cedb]">
                Some rows have no stage yet. This fuzzy-matches the bill&apos;s elements against stages you already made
                (your sequence is never restructured) and appends only the missing ones, then assigns every row.
              </p>
              <button className="btn btn-primary mt-3" disabled={busy} onClick={bootstrapStages}>
                {busy ? "Working…" : "Create/assign stages from the bill's elements"}
              </button>
            </div>
          )}

          {matDrafts.length > 0 && (
            <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <p className="px-4 pt-4 text-sm text-[#c7cedb]">
                {matDrafts.length} supply/fitting line(s) match nothing in your catalog. Edit the names and units, then
                create them in one go — rows are mapped automatically.
              </p>
              <div className="mt-3 overflow-x-auto">
                <table className="table-base min-w-[720px]">
                  <thead>
                    <tr><th>Create</th><th className="min-w-[16rem]">Material name</th><th>Unit</th><th>Rows</th><th>Price (₦)</th></tr>
                  </thead>
                  <tbody>
                    {matDrafts.map((d, i) => (
                      <tr key={d.key}>
                        <td><input type="checkbox" checked={d.on} onChange={(e) => patchMat(i, { on: e.target.checked })}
                          className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" /></td>
                        <td><input className="input py-1.5" value={d.name} onChange={(e) => patchMat(i, { name: e.target.value })} /></td>
                        <td><input className="input w-20 py-1.5" placeholder="unit" value={d.unit} onChange={(e) => patchMat(i, { unit: e.target.value })} /></td>
                        <td className="text-[#8b95a7]">{d.row_ids.length}</td>
                        <td>
                          {d.hasRate ? (
                            <div className="min-w-[13rem]">
                              <input type="number" min="0" className="input w-28 py-1.5" value={d.price}
                                onChange={(e) => patchMat(i, { price: e.target.value })} />
                              <label className="mt-1 flex items-start gap-1.5 text-[11px] leading-snug text-[#8b95a7]">
                                <input type="checkbox" checked={d.priceOn} onChange={(e) => patchMat(i, { priceOn: e.target.checked })}
                                  className="mt-0.5 h-3.5 w-3.5 rounded border-white/20 bg-transparent accent-accent-500" />
                                set as current price (all-in BOQ rate — includes delivery/labour)
                              </label>
                            </div>
                          ) : (
                            <span className="text-xs text-[#5b6473]">— no supply rate —</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="p-4">
                <button className="btn btn-primary" disabled={busy || matSelected.length === 0} onClick={bootstrapMaterials}>
                  {busy ? "Creating…" : `Create ${matSelected.length} material${matSelected.length === 1 ? "" : "s"} in my catalog`}
                </button>
              </div>
            </div>
          )}

          {compositeCandidates.length > 0 && (
            <AssemblyProposals
              orgId={orgId}
              mode="review"
              candidates={compositeCandidates}
              materials={materials}
              assemblies={assemblies.map((a) => ({ id: a.id, name: a.name, unit: a.unit, ratio: a.ratio ?? null }))}
              prices={prices}
              onApplied={applyAssemblyAttachments}
            />
          )}
        </section>
      )}

      {/* Element groups. */}
      {groups.map(([element, groupRows]) => {
        const stat = secStats.get(element);
        const groupState = groupRows.map((r) => state[byId.get(r.id)!]);
        const allOn = groupState.every((s) => s.include);
        return (
          <details key={element} open className="card p-0 overflow-hidden">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <span className="font-semibold text-white">{element}</span>
              <span className="text-[#8b95a7]">{groupRows.length} item(s)</span>
              {stat && stat.stated != null && (
                <span className={stat.ok ? "text-emerald-300" : "text-red-300"}>
                  {ngn(stat.extracted)} vs stated {ngn(stat.stated)} {stat.ok ? "✓" : "✗"}
                </span>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-[#8b95a7]" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={allOn} onChange={(e) => setGroupInclude(groupRows, e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-white/20 bg-transparent accent-accent-500" /> include all
              </label>
            </summary>
            <div className="overflow-x-auto border-t border-white/[0.06]">
              <table className="table-base min-w-[1020px]">
                <thead>
                  <tr><th>Use</th><th>Ref</th><th className="min-w-[20rem]">Item (as written)</th><th>Kind</th><th>Material</th><th>Stage</th><th>Qty</th><th>Unit</th><th className="text-right">Rate</th></tr>
                </thead>
                <tbody>
                  {groupRows.map((r) => {
                    const i = byId.get(r.id)!;
                    const s = state[i];
                    const risky = rowRisky(r);
                    return (
                      <tr key={r.id} className={risky ? "bg-accent-500/[0.04]" : ""}>
                        <td><input type="checkbox" checked={s.include} onChange={(e) => patch(i, { include: e.target.checked })}
                          className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" /></td>
                        <td className="text-[#8b95a7]">{r.boq_ref ?? "—"}</td>
                        <td className="text-white">
                          <div className="max-w-[28rem] whitespace-normal text-[13px] leading-snug">{r.resolved_text ?? r.raw_text}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.suggested_kind && <span className="badge badge-muted">{r.suggested_kind.replace("_", " ")}</span>}
                            {r.mix_ratio && <span className="badge badge-blue">mix {r.mix_ratio}</span>}
                            {!r.is_priced && <span className="badge badge-accent">unpriced</span>}
                            {r.is_provisional && <span className="badge badge-muted">provisional</span>}
                            {(r.flags ?? []).filter((f) => f !== "ditto_resolved").map((f) => (
                              <span key={f} className="badge badge-red">{FLAG_LABEL[f] ?? f}</span>
                            ))}
                            {r.confidence != null && <span className="text-[10px] text-[#5b6473]">conf {Number(r.confidence).toFixed(2)}</span>}
                          </div>
                        </td>
                        <td>
                          <select className="select py-1.5" value={s.kind} onChange={(e) => patch(i, { kind: e.target.value })}>
                            {KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
                          </select>
                          {s.kind === "composite" && (
                            <select className={`select mt-1 py-1.5 ${s.assembly_id ? "" : "border-blue-400/40"}`} value={s.assembly_id}
                              onChange={(e) => patch(i, { assembly_id: e.target.value })}>
                              <option value="">— assembly —</option>
                              {allAssemblies.map((a) => <option key={a.id} value={a.id}>{a.name} (/{a.unit})</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          <select className={`select py-1.5 ${s.material_id || s.kind !== "material_supply" ? "" : "border-accent-500/50"}`} value={s.material_id}
                            onChange={(e) => patch(i, { material_id: e.target.value })}>
                            <option value="">{r.material_guess ? `— map (AI: ${r.material_guess}) —` : "— map —"}</option>
                            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                          </select>
                        </td>
                        <td>
                          <select className="select py-1.5" value={s.stage_id} onChange={(e) => patch(i, { stage_id: e.target.value })}>
                            <option value="">— unassigned —</option>
                            {stages.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                          </select>
                        </td>
                        <td><input type="number" className="input w-20 py-1.5" value={s.quantity} onChange={(e) => patch(i, { quantity: Number(e.target.value) })} /></td>
                        <td><input className="input w-16 py-1.5" value={s.unit} onChange={(e) => patch(i, { unit: e.target.value })} /></td>
                        <td className="text-right text-[#8b95a7]">{r.parsed_rate != null ? ngn(r.parsed_rate) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" onClick={confirm} disabled={busy || mappedCount === 0}>
          <IconCheck className="h-4 w-4" />{busy ? "Confirming…" : `Confirm ${mappedCount} row${mappedCount === 1 ? "" : "s"} as work items`}
        </button>
        <button className="btn btn-ghost" onClick={proposePrices} disabled={busy}>Propose prices from this bill</button>
        <span className="text-xs text-[#8b95a7]">Ticked rows become work items; only material-supply rows need a material (those also feed the classic recipe).</span>
        {msg && (
          <span className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
            {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
          </span>
        )}
      </div>
    </div>
  );
}
