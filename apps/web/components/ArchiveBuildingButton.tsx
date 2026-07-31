"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert } from "@/components/icons";

// Archive / restore a building (soft-delete, Rule 1 via fn_archive_building).
// Archived buildings leave the Board but the row is kept and the code frees up,
// so it can be re-stamped onto the right recipe. Two-step inline confirm — no
// native dialog (those block the automation bridge and read as abrupt).
export function ArchiveBuildingButton({
  buildingId, code, archived,
}: { buildingId: string; code: string; archived: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function archive() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_archive_building", { p_building: buildingId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push("/board");   // it's gone from this building's world — back to the board
  }

  async function restore() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_unarchive_building", { p_building: buildingId });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  if (archived) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="badge badge-muted">archived</span>
        <button className="btn btn-ghost" disabled={busy} onClick={restore}>
          {busy ? "Restoring…" : "Restore to board"}
        </button>
        {err && <span className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <span className="text-sm text-[#8b95a7]">Archive {code}? It leaves the board; you can restore it.</span>
          <button className="btn btn-danger" disabled={busy} onClick={archive}>
            {busy ? "Archiving…" : "Yes, archive"}
          </button>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
        </>
      ) : (
        <button className="btn btn-ghost" onClick={() => { setConfirming(true); setErr(null); }}>
          Archive building
        </button>
      )}
      {err && <span className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</span>}
    </div>
  );
}
