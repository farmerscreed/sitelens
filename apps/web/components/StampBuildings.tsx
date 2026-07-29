"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconCheck, IconAlert } from "@/components/icons";

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
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [count, setCount] = useState(10);
  const [batch, setBatch] = useState("");
  const [phase, setPhase] = useState("");
  const [prefix, setPrefix] = useState("B");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  async function stamp() {
    setBusy(true); setMsg(null);
    const { data, error } = await supabase.rpc("fn_create_buildings", {
      p_type: typeId, p_count: count, p_project: projectId,
      p_batch: batch || null, p_phase: phase || null, p_code_prefix: prefix,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Stamped ${data} building(s).` }); router.refresh(); }
  }

  return (
    <section className="card">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-white">
          <IconPlus className="h-4 w-4 text-accent-300" /> Stamp buildings
        </span>
        <span className="text-xs text-[#8b95a7]">{open ? "Hide" : "Create buildings from a recipe"}</span>
      </button>

      {open && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <label className="label">Building type (recipe)</label>
            <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">How many</label>
            <input type="number" min={1} className="input" value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <div>
            <label className="label">Code prefix</label>
            <input className="input" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
          </div>
          <div>
            <label className="label">Batch</label>
            <select className="select" value={batch} onChange={(e) => setBatch(e.target.value)}>
              <option value="">— none —</option>
              {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Phase</label>
            <select className="select" value={phase} onChange={(e) => setPhase(e.target.value)}>
              <option value="">— none —</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <button className="btn btn-primary" disabled={busy || !typeId || !projectId} onClick={stamp}>
              <IconPlus className="h-4 w-4" />{busy ? "Stamping…" : `Stamp ${count} building${count === 1 ? "" : "s"}`}
            </button>
            {msg && (
              <span className={`ml-3 flex items-center gap-1.5 text-sm ${msg.ok ? "text-emerald-300" : "text-red-300"}`}>
                {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
