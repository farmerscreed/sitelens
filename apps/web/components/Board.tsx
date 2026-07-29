"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconChevron } from "@/components/icons";

type Row = {
  id: string; code: string; status: string;
  building_type_id: string; type_name: string;
  batch_id: string | null; batch_name: string | null;
  current_stage_id: string | null; current_stage_name: string | null; current_stage_seq: number | null;
  stages_done: number; stages_total: number; board_column: string;
};
type Batch = { id: string; name: string; status: string };
type Type = { id: string; name: string };

const CANON = ["Not started", "Foundation", "DPC", "Lintel", "Roof", "Finishes", "Done"];
function colRank(name: string, seq: number | null): number {
  const i = CANON.indexOf(name);
  if (name === "Not started") return -1;
  if (name === "Done") return 999;
  return i >= 0 ? i : (seq ?? 500);
}

export function Board({ rows, batches, types }: { rows: Row[]; batches: Batch[]; types: Type[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [batchFilter, setBatchFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [busy, setBusy] = useState(false);

  const filtered = rows.filter(
    (r) => (!batchFilter || r.batch_id === batchFilter) && (!typeFilter || r.building_type_id === typeFilter),
  );

  const columns = useMemo(() => {
    const map = new Map<string, { rank: number; rows: Row[] }>();
    for (const r of filtered) {
      const key = r.board_column;
      if (!map.has(key)) map.set(key, { rank: colRank(key, r.current_stage_seq), rows: [] });
      map.get(key)!.rows.push(r);
    }
    return [...map.entries()].sort((a, b) => a[1].rank - b[1].rank);
  }, [filtered]);

  async function completeStage(r: Row) {
    if (!r.current_stage_id || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_complete_stage", { p_building: r.id, p_stage: r.current_stage_id });
    setBusy(false);
    if (!error) router.refresh();
  }
  async function startBatch(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("fn_advance_batch", { p_batch: id });
    setBusy(false);
    if (!error) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="select max-w-[10rem]" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
          <option value="">All batches</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="select max-w-[10rem]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="badge badge-muted">{filtered.length} buildings</span>
        {batches.map((b) => b.status !== "active" && (
          <button key={b.id} className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => startBatch(b.id)}>Start {b.name}</button>
        ))}
      </div>

      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-3">
        {columns.map(([name, col]) => (
          <div key={name} className="w-[80vw] shrink-0 snap-start rounded-2xl border border-white/[0.06] bg-white/[0.015] p-3 sm:w-64">
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="text-sm font-semibold text-white">{name}</span>
              <span className="badge badge-muted">{col.rows.length}</span>
            </div>
            <div className="space-y-2">
              {col.rows.map((r) => {
                const pct = r.stages_total > 0 ? (r.stages_done / r.stages_total) * 100 : 0;
                return (
                  <div key={r.id} className="rounded-xl border border-white/[0.08] bg-ink-850/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link className="font-semibold text-white hover:text-accent-300" href={`/buildings/${r.id}`}>{r.code}</Link>
                      <span className="truncate text-xs text-[#8b95a7]">{r.type_name}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
                        <div className="h-full rounded-full bg-accent-sheen" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] text-[#8b95a7]">{r.stages_done}/{r.stages_total}</span>
                    </div>
                    {r.batch_name && <p className="mt-1.5 text-[11px] text-[#5b6473]">{r.batch_name}</p>}
                    {r.current_stage_id && r.status !== "done" && (
                      <button className="btn btn-primary mt-2 w-full px-2 py-1.5 text-xs" disabled={busy} onClick={() => completeStage(r)}>
                        <IconCheck className="h-3.5 w-3.5" />Complete {r.current_stage_name}
                      </button>
                    )}
                  </div>
                );
              })}
              {col.rows.length === 0 && <p className="px-1 py-2 text-xs text-[#5b6473]">Empty</p>}
            </div>
          </div>
        ))}
        {columns.length === 0 && <p className="card text-sm text-[#8b95a7]">No buildings yet — use “Stamp buildings” above to create some.</p>}
      </div>
    </div>
  );
}
