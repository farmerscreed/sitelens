"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

type WorkItem = { id: string; description: string; qty_planned: number | null; unit: string | null; group: string };

// Log cumulative work done on a building (qty as of today, not an increment).
// Client-generated idempotency_key mirrors the offline path — safe to retry.
// Write goes through fn_log_work_done (SECURITY DEFINER, manager-gated — Rule 1).
export function LogWorkDoneForm({ buildingId, workItems }: { buildingId: string; workItems: WorkItem[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [workItem, setWorkItem] = useState(workItems[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const sel = workItems.find((w) => w.id === workItem);

  // Group the dropdown by stage (first-seen order; items arrive pre-sorted by
  // stage sequence) so a task is easy to find under its stage.
  const groups: { label: string; items: WorkItem[] }[] = [];
  for (const w of workItems) {
    let g = groups.find((x) => x.label === w.group);
    if (!g) { g = { label: w.group, items: [] }; groups.push(g); }
    g.items.push(w);
  }

  async function submit() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_log_work_done", {
      p_building: buildingId, p_work_item: workItem, p_qty_done: Number(qty),
      p_idempotency_key: crypto.randomUUID(), p_note: note.trim() || null,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Logged ${qty} ${sel?.unit ?? ""} done.` }); setQty(""); setNote(""); router.refresh(); }
  }

  const disabled = busy || !workItem || qty === "" || Number(qty) < 0;

  return (
    <section className="card max-w-3xl">
      <h2 className="text-sm font-semibold text-white">Log work done</h2>
      <p className="mt-1 text-xs text-[#8b95a7]">
        Enter the <strong className="text-[#c7cedb]">cumulative</strong> quantity completed to date — not today&apos;s increment.
        Earned value updates from the latest figure × the live unit cost.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="label">Work item</label>
          <select className="select" value={workItem} onChange={(e) => setWorkItem(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.items.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.description.length > 70 ? `${w.description.slice(0, 70)}…` : w.description}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="label">
            Qty done {sel?.unit && <span className="text-[#5b6473]">({sel.unit}{sel.qty_planned != null ? ` of ${Number(sel.qty_planned).toLocaleString("en-NG")}` : ""})</span>}
          </label>
          <input type="number" min="0" className="input" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <div>
          <label className="label">Note <span className="text-[#5b6473]">(optional)</span></label>
          <input className="input" placeholder="—" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" disabled={disabled} onClick={submit}>
          {busy ? "Logging…" : "Log work done"}
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
