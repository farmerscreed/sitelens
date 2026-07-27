"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Marks the building's current stage complete via fn_complete_stage (Rule 1).
export function CompleteStageButton({ buildingId, stageId }: { buildingId: string; stageId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_complete_stage", { p_building: buildingId, p_stage: stageId });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <div>
      <button className="rounded-md bg-neutral-900 px-3 py-1 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        disabled={busy} onClick={run}>{busy ? "Working…" : "Complete current stage"}</button>
      {err && <p className="mt-1 text-sm text-red-600">{err}</p>}
    </div>
  );
}
