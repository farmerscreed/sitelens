import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompleteStageButton } from "@/components/CompleteStageButton";
import { LogWorkDoneForm } from "@/components/LogWorkDoneForm";
import { IconChevron, IconCheck, IconAlert } from "@/components/icons";

type EvRow = {
  work_item_id: string; stage_id: string | null; element_name: string | null;
  description: string; kind: string; qty_planned: string | null; unit: string | null;
  qty_done: string | null; unit_cost_live: string | null;
  planned_value: string | null; earned_value: string | null; boq_amount: string | null;
};

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

export default async function BuildingDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: b } = await supabase
    .from("buildings").select("id,code,status,building_type_id,current_stage_id").eq("id", params.id).single();
  if (!b) redirect("/board");

  const [{ data: stages }, { data: progress }, { data: materials }, { data: rva }, { data: evRows }] = await Promise.all([
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", b.building_type_id).order("sequence"),
    supabase.from("building_stage_progress").select("stage_id,status,completed_at").eq("building_id", b.id),
    supabase.from("materials_catalog").select("id,name"),
    supabase.from("building_req_vs_actual").select("material_id,required,consumed,overrun").eq("building_id", b.id),
    supabase.from("building_work_ev")
      .select("work_item_id,stage_id,element_name,description,kind,qty_planned,unit,qty_done,unit_cost_live,planned_value,earned_value,boq_amount")
      .eq("building_id", b.id).order("element_name"),
  ]);

  const ev = (evRows ?? []) as EvRow[];
  const totalPlanned = ev.filter((r) => r.planned_value != null).reduce((a, r) => a + Number(r.planned_value), 0);
  const totalEarned = ev.filter((r) => r.earned_value != null).reduce((a, r) => a + Number(r.earned_value), 0);
  const pctEarned = totalPlanned > 0 ? Math.round((totalEarned / totalPlanned) * 100) : null;

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

      {/* Earned value — planned vs earned at LIVE prices (Rule 4). Hidden until the
          recipe has work items (confirm a BOQ import first). */}
      {ev.length > 0 && (
        <>
          <section className="card p-0 overflow-hidden">
            <div className="px-5 pt-5">
              <h2 className="text-sm font-semibold text-white">Earned value</h2>
              <p className="mt-0.5 text-xs text-[#8b95a7]">
                Earned = latest cumulative qty done × live unit cost — what the work completed is worth at today&apos;s prices.
              </p>
            </div>
            <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
              <div>
                <div className="stat-label">Planned value</div>
                <div className="mt-1 font-mono text-xl font-semibold text-white">{ngn(totalPlanned)}</div>
              </div>
              <div>
                <div className="stat-label">Earned value</div>
                <div className="mt-1 font-mono text-xl font-semibold text-emerald-300">{ngn(totalEarned)}</div>
              </div>
              <div>
                <div className="stat-label">Progress by value</div>
                <div className="mt-1 font-mono text-xl font-semibold text-white">{pctEarned != null ? `${pctEarned}%` : "—"}</div>
              </div>
            </div>
            <div className="overflow-x-auto border-t border-white/[0.06]">
              <table className="table-base min-w-[820px]">
                <thead>
                  <tr><th className="min-w-[20rem]">Work item</th><th className="text-right">Done / planned</th><th className="text-right">Live unit cost</th><th className="text-right">Planned value</th><th className="text-right">Earned value</th></tr>
                </thead>
                <tbody>
                  {ev.map((r) => (
                    <tr key={r.work_item_id}>
                      <td className="text-white">
                        <div className="max-w-[26rem] whitespace-normal text-[13px] leading-snug">{r.description}</div>
                        <div className="mt-0.5 text-[10px] text-[#5b6473]">{r.element_name ?? "—"} · {r.kind.replace("_", " ")}</div>
                      </td>
                      <td className="text-right font-mono">
                        {r.qty_done != null ? Number(r.qty_done).toLocaleString("en-NG") : "0"}
                        <span className="text-[#8b95a7]"> / {r.qty_planned != null ? Number(r.qty_planned).toLocaleString("en-NG") : "—"} {r.unit ?? ""}</span>
                      </td>
                      <td className="text-right font-mono text-[#8b95a7]">{r.unit_cost_live != null ? ngn(Number(r.unit_cost_live)) : "—"}</td>
                      <td className="text-right font-mono">{r.planned_value != null ? ngn(Number(r.planned_value)) : "—"}</td>
                      <td className="text-right font-mono text-emerald-300">{r.earned_value != null ? ngn(Number(r.earned_value)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <LogWorkDoneForm
            buildingId={b.id}
            workItems={ev.map((r) => ({
              id: r.work_item_id, description: r.description,
              qty_planned: r.qty_planned != null ? Number(r.qty_planned) : null, unit: r.unit,
            }))}
          />
        </>
      )}
    </div>
  );
}
