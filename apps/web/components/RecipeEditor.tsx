"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconAlert } from "@/components/icons";

type Stage = { id: string; name: string; sequence: number };
type Item = { id: string; stage_id: string | null; material_id: string; quantity: number; unit: string };
type Cost = { id: string; stage_id: string | null; category: string; amount: number };
type Material = { id: string; name: string; unit: string };
type Cost3 = { materials_cost: number; nonmaterial_cost: number; total_cost: number };

export function RecipeEditor({
  type, stages, items, costs, materials, cost,
}: {
  type: { id: string; name: string; category: string | null; version: number };
  stages: Stage[]; items: Item[]; costs: Cost[]; materials: Material[]; cost: Cost3;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const matName = (id: string) => materials.find((m) => m.id === id)?.name ?? id;

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  const [stageName, setStageName] = useState("");
  const [stageSeq, setStageSeq] = useState(stages.length + 1);
  const [biStage, setBiStage] = useState<string>(stages[0]?.id ?? "");
  const [biMat, setBiMat] = useState<string>(materials[0]?.id ?? "");
  const [biQty, setBiQty] = useState("");
  const [scStage, setScStage] = useState<string>(stages[0]?.id ?? "");
  const [scCat, setScCat] = useState("labour");
  const [scAmt, setScAmt] = useState("");

  const naira = (n: number) => "₦" + Number(n).toLocaleString();

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{type.name}</h1>
          <p className="mt-1 text-sm text-[#8b95a7]">{type.category ?? "—"} · version {type.version}</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] px-5 py-3 text-right">
          <div className="stat-label">Live cost / building</div>
          <div className="mt-1 font-mono text-2xl font-semibold text-white">{naira(cost.total_cost)}</div>
          <div className="mt-0.5 text-xs text-[#8b95a7]">materials {naira(cost.materials_cost)} · other {naira(cost.nonmaterial_cost)}</div>
        </div>
      </header>

      {/* Stages */}
      <section className="card">
        <h2 className="text-sm font-semibold text-white">Stages</h2>
        <ol className="mt-3 space-y-1.5">
          {stages.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-sm text-[#c7cedb]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.06] text-xs font-semibold text-accent-300">{s.sequence}</span>
              {s.name}
            </li>
          ))}
          {stages.length === 0 && <li className="text-sm text-[#8b95a7]">No stages yet.</li>}
        </ol>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1"><label className="label">Stage name</label>
            <input className="input" placeholder="e.g. Foundation" value={stageName} onChange={(e) => setStageName(e.target.value)} /></div>
          <div className="sm:w-24"><label className="label">Order</label>
            <input type="number" className="input" value={stageSeq} onChange={(e) => setStageSeq(Number(e.target.value))} /></div>
          <button className="btn btn-primary shrink-0" disabled={busy || !stageName}
            onClick={() => call("fn_add_type_stage", { p_type: type.id, p_name: stageName, p_sequence: stageSeq })}><IconPlus className="h-4 w-4" />Add</button>
        </div>
      </section>

      {/* Material quantities */}
      <section className="card p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold text-white">Material quantities</h2>
          <p className="mt-0.5 text-xs text-[#8b95a7]">Quantities only — no prices (Rule 4). Cost is computed live from the price list.</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Material</th><th className="text-right">Quantity</th></tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}><td className="text-white">{matName(i.material_id)}</td>
                  <td className="text-right font-mono">{Number(i.quantity).toLocaleString()} <span className="text-[#8b95a7]">{i.unit}</span></td></tr>
              ))}
              {items.length === 0 && <tr><td colSpan={2} className="py-5 text-center text-[#8b95a7]">No quantities set.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 p-5 sm:flex-row sm:items-end">
          <div className="flex-1"><label className="label">Stage</label>
            <select className="select" value={biStage} onChange={(e) => setBiStage(e.target.value)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="flex-1"><label className="label">Material</label>
            <select className="select" value={biMat} onChange={(e) => setBiMat(e.target.value)}>
              {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select></div>
          <div className="sm:w-28"><label className="label">Quantity</label>
            <input type="number" className="input" placeholder="0" value={biQty} onChange={(e) => setBiQty(e.target.value)} /></div>
          <button className="btn btn-primary shrink-0" disabled={busy || !biMat || biQty === ""}
            onClick={() => call("fn_set_type_boq_item", { p_type: type.id, p_stage: biStage || null, p_material: biMat, p_quantity: Number(biQty), p_unit: materials.find((m) => m.id === biMat)?.unit ?? "" })}>Set</button>
        </div>
      </section>

      {/* Non-material costs */}
      <section className="card p-0 overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-white">Non-material costs</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Category</th><th className="text-right">Amount</th></tr></thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}><td className="text-white">{c.category}</td><td className="text-right font-mono">{naira(c.amount)}</td></tr>
              ))}
              {costs.length === 0 && <tr><td colSpan={2} className="py-5 text-center text-[#8b95a7]">No non-material costs.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 p-5 sm:flex-row sm:items-end">
          <div className="flex-1"><label className="label">Stage</label>
            <select className="select" value={scStage} onChange={(e) => setScStage(e.target.value)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div className="flex-1"><label className="label">Category</label>
            <select className="select" value={scCat} onChange={(e) => setScCat(e.target.value)}>
              {["labour", "plant", "other"].map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div className="sm:w-32"><label className="label">Amount (₦)</label>
            <input type="number" className="input" placeholder="0" value={scAmt} onChange={(e) => setScAmt(e.target.value)} /></div>
          <button className="btn btn-primary shrink-0" disabled={busy || scAmt === ""}
            onClick={() => call("fn_set_type_stage_cost", { p_type: type.id, p_stage: scStage || null, p_category: scCat, p_amount: Number(scAmt) })}>Set</button>
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button className="btn btn-ghost" disabled={busy}
          onClick={() => call("fn_duplicate_type", { p_type: type.id, p_new_name: `${type.name} (copy)` })}>Duplicate</button>
        <button className="btn btn-ghost" disabled={busy}
          onClick={() => call("fn_new_type_version", { p_type: type.id })}>New version</button>
      </div>
      {err && <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </div>
  );
}
