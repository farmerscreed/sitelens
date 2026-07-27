import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompleteStageButton } from "@/components/CompleteStageButton";

export default async function BuildingDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: b } = await supabase
    .from("buildings")
    .select("id,code,status,building_type_id,current_stage_id")
    .eq("id", params.id)
    .single();
  if (!b) redirect("/board");

  const [{ data: stages }, { data: progress }, { data: items }, { data: materials }] = await Promise.all([
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", b.building_type_id).order("sequence"),
    supabase.from("building_stage_progress").select("stage_id,status,completed_at").eq("building_id", b.id),
    supabase.from("type_boq_items").select("stage_id,material_id,quantity,unit").eq("building_type_id", b.building_type_id),
    supabase.from("materials_catalog").select("id,name"),
  ]);

  const statusOf = new Map((progress ?? []).map((p) => [p.stage_id, p.status]));
  const doneStageIds = new Set((progress ?? []).filter((p) => p.status === "done").map((p) => p.stage_id));
  const matName = (id: string) => (materials ?? []).find((m) => m.id === id)?.name ?? id;

  // Required materials for COMPLETED stages (recipe side). The "consumed" column and
  // the used>required overrun flag arrive with M5 materials.
  const required = (items ?? []).filter((i) => i.stage_id && doneStageIds.has(i.stage_id));

  return (
    <main className="space-y-5">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Building {b.code}</h1>
        <span className="text-sm text-neutral-500">status: {b.status}</span>
      </header>

      <section>
        <h2 className="mb-2 text-sm font-medium">Stages</h2>
        <ol className="space-y-1 text-sm">
          {(stages ?? []).map((s) => {
            const st = statusOf.get(s.id) ?? "not_started";
            return (
              <li key={s.id} className="flex items-center justify-between">
                <span>{s.sequence}. {s.name}</span>
                <span className={
                  st === "done" ? "text-green-600" : st === "in_progress" ? "text-amber-600" : "text-neutral-400"
                }>{st}</span>
              </li>
            );
          })}
        </ol>
        {b.current_stage_id && b.status !== "done" && (
          <div className="mt-3">
            <CompleteStageButton buildingId={b.id} stageId={b.current_stage_id} />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">
          Required materials for completed stages
          <span className="ml-2 text-xs font-normal text-neutral-500">(consumed vs required — coming with M5)</span>
        </h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
              <th className="py-1">Material</th><th className="text-right">Required</th>
            </tr>
          </thead>
          <tbody>
            {required.map((i, k) => (
              <tr key={k} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1">{matName(i.material_id)}</td>
                <td className="text-right font-mono">{Number(i.quantity).toLocaleString()} {i.unit}</td>
              </tr>
            ))}
            {required.length === 0 && <tr><td colSpan={2} className="py-2 text-neutral-500">No completed stages yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
