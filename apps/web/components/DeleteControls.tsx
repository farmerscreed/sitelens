"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert, IconClose } from "@/components/icons";

// Two-click danger pattern (no native confirm dialogs): first click arms,
// second click within the armed state executes. Every delete goes through a
// SECURITY DEFINER fn with its own guards — financial history can never be
// deleted from here (the server refuses and says why).
function useDanger(run: () => Promise<void>) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function click() {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 5000); return; }
    setBusy(true); setErr(null);
    try { await run(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setArmed(false); }
    setBusy(false);
  }
  return { armed, busy, err, click };
}

function DangerButton({ armed, busy, err, click, label, armedLabel, small }: {
  armed: boolean; busy: boolean; err: string | null; click: () => void;
  label: string; armedLabel: string; small?: boolean;
}) {
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button type="button" onClick={click} disabled={busy}
        className={`${small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"} btn ${armed ? "border-red-500/50 bg-red-500/15 text-red-200" : "btn-ghost text-red-300/80 hover:text-red-200"}`}>
        {busy ? "Deleting…" : armed ? armedLabel : label}
      </button>
      {err && <span className="flex max-w-[26rem] items-start gap-1 text-[11px] leading-snug text-red-300"><IconAlert className="mt-0.5 h-3 w-3 shrink-0" />{err}</span>}
    </span>
  );
}

/** Delete an extracted bill (staged import). Confirmed imports cascade their
 *  work items out of the recipe — the armed label says so. */
export function DeleteImportButton({ importId, confirmed, redirectTo, small }: {
  importId: string; confirmed?: boolean; redirectTo?: string; small?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const d = useDanger(async () => {
    const { error } = await supabase.rpc("fn_delete_boq_import", {
      p_import: importId, p_delete_work_items: !!confirmed,
    });
    if (error) throw new Error(error.message);
    if (redirectTo) router.push(redirectTo); else router.refresh();
  });
  return <DangerButton {...d} small={small} label="Delete"
    armedLabel={confirmed ? "Sure? Removes its work items too" : "Sure? Delete this import"} />;
}

/** Delete a recipe. The server refuses while buildings or planner lines use it. */
export function DeleteRecipeButton({ typeId }: { typeId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const d = useDanger(async () => {
    const { error } = await supabase.rpc("fn_delete_building_type", { p_type: typeId });
    if (error) throw new Error(error.message);
    router.push("/recipes");
  });
  return <DangerButton {...d} label="Delete this recipe"
    armedLabel="Sure? Deletes its bills, stages and work items" />;
}

/** Delete a building. The server refuses when ANY history exists (money,
 *  reports, photos, sales…) and points at archive instead. */
export function DeleteBuildingButton({ buildingId }: { buildingId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const d = useDanger(async () => {
    const { error } = await supabase.rpc("fn_delete_building", { p_building: buildingId });
    if (error) throw new Error(error.message);
    router.push("/board");
  });
  return <DangerButton {...d} label="Delete building" armedLabel="Sure? Only works if it has no history" />;
}

/** Per-line recipe controls: move a work item to a stage, or delete the line.
 *  Supply lines rebuild their classic-recipe contribution on both paths. */
export function WorkItemRowControls({ id, stageId, stages }: {
  id: string; stageId: string | null; stages: { id: string; name: string }[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const d = useDanger(async () => {
    const { error } = await supabase.rpc("fn_delete_work_item", { p_work_item: id });
    if (error) throw new Error(error.message);
    router.refresh();
  });

  async function moveStage(v: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_update_work_item", {
      p_work_item: id, p_kind: null, p_assembly: null, p_material: null,
      p_clear_material: false, p_clear_assembly: false, p_in_scope: null,
      p_stage: v || null, p_clear_stage: v === "",
    });
    setBusy(false);
    if (error) setErr(error.message); else router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select className="select w-32 py-0.5 text-[11px]" value={stageId ?? ""} disabled={busy}
        onChange={(e) => moveStage(e.target.value)} title="Stage">
        <option value="">no stage</option>
        {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button type="button" onClick={d.click} disabled={d.busy} title={d.armed ? "Click again to delete this line" : "Delete this line"}
        className={`grid h-5 w-5 place-items-center rounded ${d.armed ? "bg-red-500/25 text-red-200" : "text-[#5b6473] hover:text-red-300"}`}>
        <IconClose className="h-3.5 w-3.5" />
      </button>
      {(err || d.err) && <span className="text-[10px] text-red-300">{err || d.err}</span>}
    </span>
  );
}
