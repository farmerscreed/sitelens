"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

type Line = { id: string; description: string; quantity: number | null; unit: string | null; est_cost: number | null };

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

// Pull an excluded (by-others) line into ONE building as a dated variation
// (fn_add_building_variation — captures today's estimate, extends only this
// building's budget). The recipe and every other house stay untouched.
export function VariationAdder({ buildingId, lines }: { buildingId: string; lines: Line[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, true>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  async function add(line: Line) {
    setBusy(true); setAddingId(line.id); setErr(null);
    const { error } = await supabase.rpc("fn_add_building_variation", {
      p_building: buildingId, p_work_item: line.id, p_note: (notes[line.id] ?? "").trim() || null,
    });
    setBusy(false); setAddingId(null);
    if (error) setErr(error.message);
    else { setAdded((s) => ({ ...s, [line.id]: true })); router.refresh(); }
  }

  if (lines.length === 0) return null;

  return (
    <div className="space-y-2">
      {err && <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
      <ul className="space-y-2">
        {lines.map((l) => added[l.id] ? (
          <li key={l.id} className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-sm text-emerald-300">
            <IconCheck className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{l.description}</span>
            <span className="shrink-0 font-mono">added — {ngn(l.est_cost)}</span>
          </li>
        ) : (
          <li key={l.id} className="rounded-lg bg-white/[0.02] px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-[#c7cedb]">
                {l.description}
                {l.quantity != null && (
                  <span className="ml-2 text-xs text-[#5b6473]">{l.quantity.toLocaleString("en-NG")} {l.unit ?? ""}</span>
                )}
              </span>
              <span className="shrink-0 font-mono text-sm text-white">{l.est_cost != null ? ngn(l.est_cost) : <span className="text-xs text-[#5b6473]">no price yet</span>}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input className="input min-w-[12rem] flex-1 py-1.5" placeholder="note (optional) — e.g. client asked for tiles here"
                value={notes[l.id] ?? ""} disabled={busy}
                onChange={(e) => setNotes((s) => ({ ...s, [l.id]: e.target.value }))} />
              <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => add(l)}>
                {addingId === l.id
                  ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  : "Add to this house"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
