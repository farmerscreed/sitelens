"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const KINDS = ["material_supply", "composite", "labour", "plant", "provisional", "fitting", "other"] as const;

// Re-kind a misclassified work item in place (fn_update_work_item — SECURITY
// DEFINER, manager-gated). Rendered only for 'other' rows in the true-cost table.
export function WorkItemKindSelect({ id, kind }: { id: string; kind: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function change(k: string) {
    if (k === kind) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_update_work_item", {
      p_work_item: id, p_kind: k, p_assembly: null, p_material: null,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <span title={err ?? undefined}>
      <select className={`select w-auto py-1 text-xs ${err ? "border-red-500/50" : ""}`}
        defaultValue={kind} disabled={busy} onChange={(e) => change(e.target.value)}>
        {KINDS.map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}
      </select>
    </span>
  );
}
