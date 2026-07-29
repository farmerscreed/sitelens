"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

type Material = { id: string; name: string; unit: string };
type Building = { id: string; code: string };

// Log a material IN (delivery → +stock) or OUT (usage → −stock, tied to a building).
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

  const unit = materials.find((m) => m.id === material)?.unit ?? "";

  async function submit() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_log_material_txn", {
      p_id: crypto.randomUUID(), p_project: projectId, p_material: material, p_type: type,
      p_quantity: Number(qty), p_idempotency_key: crypto.randomUUID(),
      p_building: building || null,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Logged ${type} ${qty} ${unit}.` }); setQty(""); router.refresh(); }
  }

  const disabled = busy || !material || qty === "" || Number(qty) <= 0 || (type === "OUT" && !building);

  return (
    <section className="card max-w-3xl">
      <h2 className="text-sm font-semibold text-white">Log a transaction</h2>
      <p className="mt-1 text-xs text-[#8b95a7]">
        <strong className="text-[#c7cedb]">IN</strong> records a delivery into store.
        <strong className="text-[#c7cedb]"> OUT</strong> records usage issued to a building — that&apos;s how consumption is captured.
      </p>

      {/* IN / OUT toggle */}
      <div className="mt-4 grid max-w-xs grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
        {(["IN", "OUT"] as const).map((t) => (
          <button key={t} type="button" onClick={() => { setType(t); setMsg(null); }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              type === t ? "bg-accent-sheen text-ink-950 shadow" : "text-[#8b95a7] hover:text-white"
            }`}>
            {t === "IN" ? "IN · delivery" : "OUT · usage"}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label">Material</label>
          <select className="select" value={material} onChange={(e) => setMaterial(e.target.value)}>
            {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Quantity {unit && <span className="text-[#5b6473]">({unit})</span>}</label>
          <input type="number" min="0" className="input" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="label">Building {type === "OUT" ? <span className="text-accent-400">*required</span> : <span className="text-[#5b6473]">(optional)</span>}</label>
          <select className="select" value={building} onChange={(e) => setBuilding(e.target.value)}>
            <option value="">{type === "OUT" ? "Select building…" : "—"}</option>
            {buildings.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" disabled={disabled} onClick={submit}>
          {busy ? "Logging…" : `Log ${type}`}
        </button>
        {msg && (
          <span className={`flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
            {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
          </span>
        )}
      </div>
    </section>
  );
}
