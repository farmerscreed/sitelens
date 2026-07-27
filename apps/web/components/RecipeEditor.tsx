"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

  // form state
  const [stageName, setStageName] = useState("");
  const [stageSeq, setStageSeq] = useState(stages.length + 1);
  const [biStage, setBiStage] = useState<string>(stages[0]?.id ?? "");
  const [biMat, setBiMat] = useState<string>(materials[0]?.id ?? "");
  const [biQty, setBiQty] = useState("");
  const [scStage, setScStage] = useState<string>(stages[0]?.id ?? "");
  const [scCat, setScCat] = useState("labour");
  const [scAmt, setScAmt] = useState("");

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{type.name}</h1>
          <p className="text-sm text-neutral-500">{type.category ?? "—"} · v{type.version}</p>
        </div>
        <div className="text-right text-sm">
          <div className="text-neutral-500">Live cost</div>
          <div className="font-mono text-lg">₦{Number(cost.total_cost).toLocaleString()}</div>
          <div className="text-xs text-neutral-500">
            materials ₦{Number(cost.materials_cost).toLocaleString()} + other ₦{Number(cost.nonmaterial_cost).toLocaleString()}
          </div>
        </div>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-medium">Stages</h2>
        <ol className="list-decimal pl-5 text-sm">
          {stages.map((s) => <li key={s.id}>{s.name}</li>)}
        </ol>
        <div className="mt-2 flex gap-2">
          <input className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            placeholder="Stage name" value={stageName} onChange={(e) => setStageName(e.target.value)} />
          <input type="number" className="w-20 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
            value={stageSeq} onChange={(e) => setStageSeq(Number(e.target.value))} />
          <button className="rounded-md bg-neutral-900 px-3 py-1 text-white dark:bg-white dark:text-neutral-900" disabled={busy || !stageName}
            onClick={() => call("fn_add_type_stage", { p_type: type.id, p_name: stageName, p_sequence: stageSeq })}>Add stage</button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Material quantities (no price — Rule 4)</h2>
        <table className="w-full text-sm">
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1">{matName(i.material_id)}</td>
                <td className="text-right font-mono">{Number(i.quantity).toLocaleString()} {i.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap gap-2">
          <select className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" value={biStage} onChange={(e) => setBiStage(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" value={biMat} onChange={(e) => setBiMat(e.target.value)}>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
          </select>
          <input type="number" className="w-24 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" placeholder="Qty" value={biQty} onChange={(e) => setBiQty(e.target.value)} />
          <button className="rounded-md bg-neutral-900 px-3 py-1 text-white dark:bg-white dark:text-neutral-900" disabled={busy || !biMat || biQty === ""}
            onClick={() => call("fn_set_type_boq_item", { p_type: type.id, p_stage: biStage || null, p_material: biMat, p_quantity: Number(biQty), p_unit: materials.find((m) => m.id === biMat)?.unit ?? "" })}>Set quantity</button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Non-material costs</h2>
        <table className="w-full text-sm">
          <tbody>
            {costs.map((c) => (
              <tr key={c.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1">{c.category}</td>
                <td className="text-right font-mono">₦{Number(c.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap gap-2">
          <select className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" value={scStage} onChange={(e) => setScStage(e.target.value)}>
            {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" value={scCat} onChange={(e) => setScCat(e.target.value)}>
            {["labour", "plant", "other"].map((c) => <option key={c}>{c}</option>)}
          </select>
          <input type="number" className="w-28 rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" placeholder="Amount ₦" value={scAmt} onChange={(e) => setScAmt(e.target.value)} />
          <button className="rounded-md bg-neutral-900 px-3 py-1 text-white dark:bg-white dark:text-neutral-900" disabled={busy || scAmt === ""}
            onClick={() => call("fn_set_type_stage_cost", { p_type: type.id, p_stage: scStage || null, p_category: scCat, p_amount: Number(scAmt) })}>Set cost</button>
        </div>
      </section>

      <div className="flex gap-3">
        <button className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700" disabled={busy}
          onClick={() => call("fn_duplicate_type", { p_type: type.id, p_new_name: `${type.name} (copy)` })}>Duplicate</button>
        <button className="rounded-md border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700" disabled={busy}
          onClick={() => call("fn_new_type_version", { p_type: type.id })}>New version</button>
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </main>
  );
}
