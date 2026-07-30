"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

type Row = {
  id: string; raw_text: string; resolved_text: string | null;
  parsed_qty: number | null; parsed_unit: string | null; unit_normalized: string | null;
  parsed_rate: number | null; amount: number | null;
  mapped_material_id: string | null; confidence: number | null; status: string;
  row_kind: string; boq_ref: string | null; section_path: string[] | null;
  is_priced: boolean; is_provisional: boolean;
  suggested_stage_id: string | null; suggested_kind: string | null;
  mix_ratio: string | null; material_guess: string | null; flags: string[] | null;
};
type Material = { id: string; name: string; unit: string };
type Stage = { id: string; name: string; sequence: number };
type Reconciliation = {
  extracted_total: number; stated_total: number | null; variance_pct: number | null;
  sections: { element: string; extracted: number; stated: number | null; ok: boolean }[];
  flagged_rows: number; item_count: number;
} | null;

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

const FLAG_LABEL: Record<string, string> = {
  amount_mismatch: "qty×rate ≠ amount", unknown_unit: "unknown unit",
  missing_qty: "no qty", missing_unit: "no unit", qty_text_coerced: "qty was text",
  possible_duplicate: "possible duplicate", ditto_resolved: "ditto",
  ditto_unresolved: "ditto unresolved", rate_not_applicable: "rate N/A",
};

// Review v2 (BOQ_TRUE_COST_DESIGN §11): reconciliation banner, element groups,
// risk-first highlighting, full descriptions, unpriced scope surfaced. Every row
// stays a proposal until fn_confirm_boq_import — the only write path into a recipe.
export function BoqReview({
  importId, format, status, reconciliation, pricedTotal, unpricedCount, rows, materials, stages,
}: {
  importId: string; format: string; status: string;
  reconciliation: Reconciliation; pricedTotal: number | null; unpricedCount: number | null;
  rows: Row[]; materials: Material[]; stages: Stage[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const items = useMemo(() => rows.filter((r) => r.row_kind === "item"), [rows]);
  // Stage defaults to the extractor's SUGGESTION; otherwise unassigned — the human places it.
  const [state, setState] = useState(
    items.map((r) => ({
      row_id: r.id, include: true,
      material_id: r.mapped_material_id ?? "",
      stage_id: r.suggested_stage_id ?? "",
      quantity: r.parsed_qty ?? 0,
      unit: r.unit_normalized ?? r.parsed_unit ?? "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

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
  async function confirm() {
    setBusy(true); setMsg(null);
    const confirmations = state.filter((r) => r.include && r.material_id).map((r) => ({
      row_id: r.row_id, material_id: r.material_id, quantity: Number(r.quantity),
      unit: r.unit, stage_id: r.stage_id || null,
    }));
    const { data, error } = await supabase.rpc("fn_confirm_boq_import", { p_import: importId, p_confirmations: confirmations });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Confirmed ${data} row(s) into the recipe.` }); router.refresh(); }
  }

  const needsAttention = items.filter((r) => (r.flags?.length ?? 0) > 0 || !state[byId.get(r.id)!]?.material_id).length;
  const mappedCount = state.filter((r) => r.include && r.material_id).length;
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
          <IconAlert className="h-4 w-4" />{needsAttention} row(s) need attention (flagged or unmapped) — they&apos;re highlighted below.
        </p>
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
              <table className="table-base min-w-[860px]">
                <thead>
                  <tr><th>Use</th><th>Ref</th><th className="min-w-[20rem]">Item (as written)</th><th>Material</th><th>Stage</th><th>Qty</th><th>Unit</th><th className="text-right">Rate</th></tr>
                </thead>
                <tbody>
                  {groupRows.map((r) => {
                    const i = byId.get(r.id)!;
                    const s = state[i];
                    const risky = (r.flags?.length ?? 0) > 0 || !s.material_id;
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
                          <select className={`select py-1.5 ${s.material_id ? "" : "border-accent-500/50"}`} value={s.material_id}
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
          <IconCheck className="h-4 w-4" />{busy ? "Confirming…" : `Confirm ${mappedCount} row${mappedCount === 1 ? "" : "s"} into recipe`}
        </button>
        <span className="text-xs text-[#8b95a7]">Only ticked rows with a material are written. Same material + stage sums.</span>
        {msg && (
          <span className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
            {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
          </span>
        )}
      </div>
    </div>
  );
}
