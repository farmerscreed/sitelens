"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
          <option value="">All batches</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">All types</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <span className="text-neutral-500">{filtered.length} buildings</span>
        {batches.map((b) => b.status !== "active" && (
          <button key={b.id} className="rounded border border-neutral-300 px-2 py-1 dark:border-neutral-700"
            disabled={busy} onClick={() => startBatch(b.id)}>Start {b.name}</button>
        ))}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map(([name, col]) => (
          <div key={name} className="min-w-[180px] flex-1 rounded-lg bg-neutral-100 p-2 dark:bg-neutral-900">
            <div className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>{name}</span><span className="text-neutral-500">{col.rows.length}</span>
            </div>
            <div className="space-y-2">
              {col.rows.map((r) => (
                <div key={r.id} className="rounded-md border border-neutral-200 bg-white p-2 text-sm dark:border-neutral-800 dark:bg-neutral-950">
                  <div className="flex items-center justify-between">
                    <Link className="font-medium underline" href={`/buildings/${r.id}`}>{r.code}</Link>
                    <span className="text-xs text-neutral-500">{r.type_name}</span>
                  </div>
                  <div className="text-xs text-neutral-500">
                    {r.stages_done}/{r.stages_total} stages{r.batch_name ? ` · ${r.batch_name}` : ""}
                  </div>
                  {r.current_stage_id && r.status !== "done" && (
                    <button className="mt-1 w-full rounded bg-neutral-900 px-2 py-1 text-xs text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
                      disabled={busy} onClick={() => completeStage(r)}>
                      Complete {r.current_stage_name}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        {columns.length === 0 && <p className="text-sm text-neutral-500">No buildings yet — stamp some above.</p>}
      </div>
    </div>
  );
}
