"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert } from "@/components/icons";

// Take the budget "photograph": the recipe's cost at today's prices, remembered
// forever by this building (fn_snapshot_building_budget — idempotent, the first
// photo stands). The recipe itself stays live; only the building keeps a number.
export function SnapshotBudgetButton({ buildingId }: { buildingId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function snap() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_snapshot_building_budget", { p_building: buildingId });
    setBusy(false);
    if (error) setErr(error.message);
    else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button className="btn btn-primary" disabled={busy} onClick={snap}>
        {busy ? "Taking the photo…" : "Set this building's budget (today's prices)"}
      </button>
      {err && <span className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</span>}
    </div>
  );
}
