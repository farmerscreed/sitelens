"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Material = { id: string; name: string; unit: string };
type Building = { id: string; code: string };

// Log a material IN (delivery) or OUT (usage). OUT must be tagged to a building.
// Client-generated id + idempotency_key mirror the offline path (safe to retry).
export function LogTxnForm({ projectId, materials, buildings }: { projectId: string; materials: Material[]; buildings: Building[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [type, setType] = useState<"IN" | "OUT">("IN");
  const [material, setMaterial] = useState(materials[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [building, setBuilding] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function submit() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_log_material_txn", {
      p_id: crypto.randomUUID(), p_project: projectId, p_material: material, p_type: type,
      p_quantity: Number(qty), p_idempotency_key: crypto.randomUUID(),
      p_building: type === "OUT" ? building || null : building || null,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Logged ${type} ${qty}.` }); setQty(""); router.refresh(); }
  }

  return (
    <div className="max-w-2xl space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-sm font-medium">Log a transaction</h2>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <select className="rounded border px-2 py-1 dark:bg-neutral-900" value={type} onChange={(e) => setType(e.target.value as "IN" | "OUT")}>
          <option value="IN">IN (delivery)</option><option value="OUT">OUT (usage)</option>
        </select>
        <select className="rounded border px-2 py-1 dark:bg-neutral-900" value={material} onChange={(e) => setMaterial(e.target.value)}>
          {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <input type="number" min="0" className="w-24 rounded border px-2 py-1 dark:bg-neutral-900" placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
        <select className="rounded border px-2 py-1 dark:bg-neutral-900" value={building} onChange={(e) => setBuilding(e.target.value)}>
          <option value="">{type === "OUT" ? "building (required)" : "building (optional)"}</option>
          {buildings.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
        </select>
        <button className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          disabled={busy || !material || qty === "" || (type === "OUT" && !building)} onClick={submit}>
          {busy ? "Logging…" : "Log"}
        </button>
      </div>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.t}</p>}
    </div>
  );
}
