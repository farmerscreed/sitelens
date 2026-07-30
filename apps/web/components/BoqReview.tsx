"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

type Row = {
  id: string; raw_text: string; parsed_qty: number | null; parsed_unit: string | null;
  mapped_material_id: string | null; confidence: number | null; status: string;
};
type Material = { id: string; name: string; unit: string };
type Stage = { id: string; name: string; sequence: number };

// Review staged BOQ rows (proposals), map each to a catalogue material and a stage,
// then confirm. Confirm calls fn_confirm_boq_import — the only write path into the recipe.
export function BoqReview({
  importId, format, status, rows, materials, stages,
}: {
  importId: string; format: string; status: string;
  rows: Row[]; materials: Material[]; stages: Stage[];
}) {
  const router = useRouter();
  const supabase = createClient();
  // Stage starts UNASSIGNED — the human places each row (never silently stages[0]).
  const [state, setState] = useState(
    rows.map((r) => ({
      row_id: r.id, include: true, material_id: r.mapped_material_id ?? "",
      stage_id: "", quantity: r.parsed_qty ?? 0, unit: r.parsed_unit ?? "",
      raw_text: r.raw_text, confidence: r.confidence,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  function patch(i: number, p: Partial<(typeof state)[number]>) {
    setState((s) => s.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }
  async function confirm() {
    setBusy(true); setMsg(null);
    const confirmations = state.filter((r) => r.include && r.material_id).map((r) => ({
      row_id: r.row_id, material_id: r.material_id, quantity: Number(r.quantity), unit: r.unit, stage_id: r.stage_id || null,
    }));
    const { data, error } = await supabase.rpc("fn_confirm_boq_import", { p_import: importId, p_confirmations: confirmations });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Confirmed ${data} row(s) into the recipe.` }); router.refresh(); }
  }

  const mappedCount = state.filter((r) => r.include && r.material_id).length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">Review BOQ import</h1>
        <p className="mt-1 text-sm text-[#8b95a7]">
          <span className="badge badge-muted mr-2">{format.toUpperCase()}</span>{status} · each row is a proposal — map it to a material, then confirm. Unfamiliar items are remembered for next time.
        </p>
      </div>

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base min-w-[720px]">
            <thead>
              <tr><th>Use</th><th>Item (as written)</th><th>Material</th><th>Stage</th><th>Qty</th><th>Unit</th><th className="text-right">Conf.</th></tr>
            </thead>
            <tbody>
              {state.map((r, i) => (
                <tr key={r.row_id}>
                  <td><input type="checkbox" checked={r.include} onChange={(e) => patch(i, { include: e.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" /></td>
                  <td className="max-w-[16rem] truncate text-white" title={r.raw_text}>{r.raw_text}</td>
                  <td>
                    <select className={`select py-1.5 ${r.material_id ? "" : "border-accent-500/50"}`} value={r.material_id} onChange={(e) => patch(i, { material_id: e.target.value })}>
                      <option value="">— map —</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select className="select py-1.5" value={r.stage_id} onChange={(e) => patch(i, { stage_id: e.target.value })}>
                      <option value="">— unassigned —</option>
                      {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td><input type="number" className="input w-20 py-1.5" value={r.quantity} onChange={(e) => patch(i, { quantity: Number(e.target.value) })} /></td>
                  <td><input className="input w-16 py-1.5" value={r.unit} onChange={(e) => patch(i, { unit: e.target.value })} /></td>
                  <td className="text-right text-[#8b95a7]">{r.confidence != null ? r.confidence.toFixed(2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" onClick={confirm} disabled={busy || mappedCount === 0}>
          <IconCheck className="h-4 w-4" />{busy ? "Confirming…" : `Confirm ${mappedCount} row${mappedCount === 1 ? "" : "s"} into recipe`}
        </button>
        {msg && (
          <span className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
            {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
          </span>
        )}
      </div>
    </div>
  );
}
