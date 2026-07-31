"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Move one bill line in or out of the CONTRACT on the recipe (fn_update_work_item
// p_in_scope). One tap, visible feedback, the row moves lists on refresh.
// Pulling excluded work into a single building is a variation there, not this.
export function ScopeToggle({ id, inScope }: { id: string; inScope: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_update_work_item", {
      p_work_item: id, p_kind: null, p_assembly: null, p_material: null,
      p_clear_material: false, p_clear_assembly: false, p_in_scope: !inScope,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return inScope ? (
    <button type="button" title={err ?? "Mark this line as by-others (out of the contract)"}
      disabled={busy} onClick={toggle}
      className={`text-[10px] transition ${err ? "text-red-300" : "text-[#5b6473] hover:text-red-300"}`}>
      {busy ? "…" : "✕ remove from contract"}
    </button>
  ) : (
    <button type="button" title={err ?? "Bring this line into the contract"}
      disabled={busy} onClick={toggle}
      className={`btn btn-ghost px-2.5 py-1 text-xs ${err ? "border-red-500/40 text-red-300" : ""}`}>
      {busy ? "…" : "include in contract"}
    </button>
  );
}
