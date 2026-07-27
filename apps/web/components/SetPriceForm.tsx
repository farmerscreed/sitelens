"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Material = { id: string; name: string; unit: string };

// Sets a new dated price via fn_set_material_price (the ONLY write path into the
// price list — Rule 1). No direct table insert from the client.
export function SetPriceForm({
  orgId,
  materials,
  today,
}: {
  orgId: string;
  materials: Material[];
  today: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [materialId, setMaterialId] = useState(materials[0]?.id ?? "");
  const [price, setPrice] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_set_material_price", {
      p_org: orgId,
      p_material: materialId,
      p_unit_price: Number(price),
      p_effective_from: effectiveFrom,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, text: error.message });
    else {
      setMsg({ ok: true, text: "Price saved." });
      setPrice("");
      router.refresh();
    }
  }

  return (
    <div className="max-w-md space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-sm font-medium">Set a price</h2>
      <select
        className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        value={materialId}
        onChange={(e) => setMaterialId(e.target.value)}
      >
        {materials.map((m) => (
          <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
        ))}
      </select>
      <div className="flex gap-2">
        <input
          className="w-1/2 rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          type="number" min="0" step="0.01" placeholder="Unit price (₦)"
          value={price} onChange={(e) => setPrice(e.target.value)}
        />
        <input
          className="w-1/2 rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
          type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </div>
      <button
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={submit}
        disabled={busy || !materialId || price === ""}
      >
        {busy ? "Saving…" : "Save dated price"}
      </button>
      {msg && <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}
    </div>
  );
}
