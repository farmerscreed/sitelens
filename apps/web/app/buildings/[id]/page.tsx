import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompleteStageButton } from "@/components/CompleteStageButton";
import { IconChevron, IconCheck, IconAlert } from "@/components/icons";

export default async function BuildingDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: b } = await supabase
    .from("buildings").select("id,code,status,building_type_id,current_stage_id").eq("id", params.id).single();
  if (!b) redirect("/board");

  const [{ data: stages }, { data: progress }, { data: materials }, { data: rva }] = await Promise.all([
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", b.building_type_id).order("sequence"),
    supabase.from("building_stage_progress").select("stage_id,status,completed_at").eq("building_id", b.id),
    supabase.from("materials_catalog").select("id,name"),
    supabase.from("building_req_vs_actual").select("material_id,required,consumed,overrun").eq("building_id", b.id),
  ]);

  const statusOf = new Map((progress ?? []).map((p) => [p.stage_id, p.status]));
  const matName = (id: string) => (materials ?? []).find((m) => m.id === id)?.name ?? id;
  const badge = (st: string) => st === "done" ? "badge-green" : st === "in_progress" ? "badge-accent" : "badge-muted";

  return (
    <div className="space-y-6">
      <Link href="/board" className="inline-flex items-center gap-1 text-sm text-[#8b95a7] transition hover:text-white">
        <IconChevron className="h-4 w-4 rotate-90" /> Back to board
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Building {b.code}</h1>
        <span className={`badge ${badge(b.status)}`}>{b.status}</span>
      </header>

      <section className="card">
        <h2 className="text-sm font-semibold text-white">Stages</h2>
        <ol className="mt-3 space-y-1.5">
          {(stages ?? []).map((s) => {
            const st = statusOf.get(s.id) ?? "not_started";
            return (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-sm">
                <span className="flex items-center gap-3 text-[#c7cedb]">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/[0.06] text-xs font-semibold text-accent-300">{s.sequence}</span>
                  {s.name}
                </span>
                <span className={`badge ${badge(st)}`}>{st.replace("_", " ")}</span>
              </li>
            );
          })}
          {(stages ?? []).length === 0 && <li className="text-sm text-[#8b95a7]">No stages defined on this recipe.</li>}
        </ol>
        {b.current_stage_id && b.status !== "done" && (
          <div className="mt-4"><CompleteStageButton buildingId={b.id} stageId={b.current_stage_id} /></div>
        )}
      </section>

      <section className="card p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold text-white">Requirement vs actual</h2>
          <p className="mt-0.5 text-xs text-[#8b95a7]">Across completed stages — what the BOQ required vs what was actually consumed on this building.</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Material</th><th className="text-right">Required</th><th className="text-right">Consumed</th><th className="text-right">Overrun</th></tr>
            </thead>
            <tbody>
              {(rva ?? []).map((r, k) => {
                const over = Number(r.overrun) > 0;
                return (
                  <tr key={k}>
                    <td className="font-medium text-white">{matName(r.material_id)}</td>
                    <td className="text-right font-mono">{Number(r.required).toLocaleString()}</td>
                    <td className="text-right font-mono">{Number(r.consumed).toLocaleString()}</td>
                    <td className={`text-right font-mono ${over ? "text-red-300" : "text-[#8b95a7]"}`}>
                      {over ? <span className="inline-flex items-center gap-1"><IconAlert className="h-3.5 w-3.5" />+{Number(r.overrun).toLocaleString()}</span>
                            : <span className="inline-flex items-center gap-1"><IconCheck className="h-3.5 w-3.5" />{Number(r.overrun).toLocaleString()}</span>}
                    </td>
                  </tr>
                );
              })}
              {(rva ?? []).length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[#8b95a7]">No completed stages or usage yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
