"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert } from "@/components/icons";

// The manager's revert for a wrong stage tick (fn_reopen_stage, manager-only):
// the stage goes back to in-progress and the building's current stage rewinds.
// Two-tap inline confirm, no browser dialog.
export function ReopenStageButton({ buildingId, stageId, stageName }: { buildingId: string; stageId: string; stageName: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function reopen() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_reopen_stage", { p_building: buildingId, p_stage: stageId });
    setBusy(false);
    if (error) { setErr(error.message); setConfirming(false); return; }
    router.refresh();
  }

  if (err) return <span className="flex items-center gap-1 text-xs text-red-300"><IconAlert className="h-3.5 w-3.5" />{err}</span>;
  if (confirming) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className="text-[11px] text-[#8b95a7]">Undo {stageName}?</span>
        <button className="btn btn-danger px-2 py-0.5 text-[11px]" disabled={busy} onClick={reopen}>Yes</button>
        <button className="btn btn-ghost px-2 py-0.5 text-[11px]" onClick={() => setConfirming(false)}>No</button>
      </span>
    );
  }
  return (
    <button className="text-[11px] text-[#5b6473] underline-offset-2 hover:text-white hover:underline" title="Reopen this stage"
      onClick={() => setConfirming(true)}>
      undo
    </button>
  );
}
