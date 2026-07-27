"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Row = {
  id: string; raw_text: string; parsed_qty: number | null; parsed_unit: string | null;
  mapped_material_id: string | null; confidence: number | null; status: string;
};
type Material = { id: string; name: string; unit: string };
type Stage = { id: string; name: string; sequence: number };

// Review staged BOQ rows (proposals), map each to a catalogue material and a stage,
// then confirm. Confirm calls fn_confirm_boq_import — the only write path into the
// recipe (Rule 1/3). Unfamiliar rows arrive unmapped; mapping is remembered after.
export function BoqReview({
  importId, format, status, rows, materials, stages,
}: {
  importId: string; format: string; status: string;
  rows: Row[]; materials: Material[]; stages: Stage[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [state, setState] = useState(
    rows.map((r) => ({
      row_id: r.id,
      include: true,
      material_id: r.mapped_material_id ?? "",
      stage_id: stages[0]?.id ?? "",
      quantity: r.parsed_qty ?? 0,
      unit: r.parsed_unit ?? "",
      raw_text: r.raw_text,
      confidence: r.confidence,
    })),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function patch(i: number, p: Partial<(typeof state)[number]>) {
    setState((s) => s.map((r, j) => (j === i ? { ...r, ...p } : r)));
  }

  async function confirm() {
    setBusy(true); setMsg(null);
    const confirmations = state
      .filter((r) => r.include && r.material_id)
      .map((r) => ({
        row_id: r.row_id, material_id: r.material_id,
        quantity: Number(r.quantity), unit: r.unit, stage_id: r.stage_id || null,
      }));
    const { data, error } = await supabase.rpc("fn_confirm_boq_import", {
      p_import: importId, p_confirmations: confirmations,
    });
    setBusy(false);
    if (error) setMsg(error.message);
    else { setMsg(`Confirmed ${data} row(s) into the recipe.`); router.refresh(); }
  }

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Review BOQ import</h1>
      <p className="text-sm text-neutral-500">
        {format.toUpperCase()} · status {status}. Each row is a proposal — map it to a
        material and confirm. Unfamiliar items get remembered for next time.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
            <th className="py-2">Use</th><th>Item (as written)</th><th>Material</th>
            <th>Stage</th><th>Qty</th><th>Unit</th><th>Conf.</th>
          </tr>
        </thead>
        <tbody>
          {state.map((r, i) => (
            <tr key={r.row_id} className="border-b border-neutral-100 dark:border-neutral-900">
              <td><input type="checkbox" checked={r.include} onChange={(e) => patch(i, { include: e.target.checked })} /></td>
              <td className="py-1">{r.raw_text}</td>
              <td>
                <select className={`rounded border px-1 dark:bg-neutral-900 ${r.material_id ? "" : "border-amber-500"}`}
                  value={r.material_id} onChange={(e) => patch(i, { material_id: e.target.value })}>
                  <option value="">— map —</option>
                  {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </td>
              <td>
                <select className="rounded border px-1 dark:bg-neutral-900" value={r.stage_id} onChange={(e) => patch(i, { stage_id: e.target.value })}>
                  <option value="">—</option>
                  {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </td>
              <td><input type="number" className="w-20 rounded border px-1 dark:bg-neutral-900" value={r.quantity} onChange={(e) => patch(i, { quantity: Number(e.target.value) })} /></td>
              <td><input className="w-16 rounded border px-1 dark:bg-neutral-900" value={r.unit} onChange={(e) => patch(i, { unit: e.target.value })} /></td>
              <td className="text-neutral-500">{r.confidence != null ? r.confidence.toFixed(2) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <button className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={confirm} disabled={busy}>
        {busy ? "Confirming…" : "Confirm into recipe"}
      </button>
      {msg && <p className="text-sm">{msg}</p>}
    </main>
  );
}
