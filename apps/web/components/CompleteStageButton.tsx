"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

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
      <button className="btn btn-primary" disabled={busy} onClick={run}>
        <IconCheck className="h-4 w-4" />{busy ? "Working…" : "Complete current stage"}
      </button>
      {err && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </div>
  );
}
