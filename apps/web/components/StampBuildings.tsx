"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Type = { id: string; name: string };
type Named = { id: string; name: string };

// Stamp N buildings from a type version into a project (F-BOARD / §2.1). Calls
// fn_create_buildings — the only write path (Rule 1). Buildings inherit the recipe's
// stages automatically.
export function StampBuildings({
  projectId, types, phases, batches,
}: {
  projectId: string; types: Type[]; phases: Named[]; batches: Named[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [count, setCount] = useState(10);
  const [batch, setBatch] = useState("");
  const [phase, setPhase] = useState("");
  const [prefix, setPrefix] = useState("B");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function stamp() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("fn_create_buildings", {
      p_type: typeId, p_count: count, p_project: projectId,
      p_batch: batch || null, p_phase: phase || null, p_code_prefix: prefix,
    });
    setBusy(false);
    if (error) setMsg(error.message);
    else { setMsg(`Stamped ${data} building(s).`); router.refresh(); }
  }

  return (
    <details className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
      <summary className="cursor-pointer text-sm font-medium">Stamp buildings</summary>
      <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
        <label>Type<select className="mt-1 block rounded border px-2 py-1 dark:bg-neutral-900" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Count<input type="number" min={1} className="mt-1 block w-20 rounded border px-2 py-1 dark:bg-neutral-900" value={count} onChange={(e) => setCount(Number(e.target.value))} /></label>
        <label>Prefix<input className="mt-1 block w-16 rounded border px-2 py-1 dark:bg-neutral-900" value={prefix} onChange={(e) => setPrefix(e.target.value)} /></label>
        <label>Batch<select className="mt-1 block rounded border px-2 py-1 dark:bg-neutral-900" value={batch} onChange={(e) => setBatch(e.target.value)}>
          <option value="">—</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label>Phase<select className="mt-1 block rounded border px-2 py-1 dark:bg-neutral-900" value={phase} onChange={(e) => setPhase(e.target.value)}>
          <option value="">—</option>{phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="rounded-md bg-neutral-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          disabled={busy || !typeId || !projectId} onClick={stamp}>{busy ? "Stamping…" : "Stamp"}</button>
        {msg && <span className="text-neutral-500">{msg}</span>}
      </div>
    </details>
  );
}
