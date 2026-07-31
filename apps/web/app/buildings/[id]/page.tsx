import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CompleteStageButton } from "@/components/CompleteStageButton";
import { LogWorkDoneForm } from "@/components/LogWorkDoneForm";
import { SnapshotBudgetButton } from "@/components/SnapshotBudgetButton";
import { VariationAdder } from "@/components/VariationAdder";
import { IconChevron, IconCheck, IconAlert } from "@/components/icons";

type Money = {
  budget: string | null; budget_date: string | null; variations_total: string | null;
  spent: string | null; earned: string | null; remaining: string | null; forecast: string | null;
};
type FinishRow = { material_id: string; qty_needed: string; in_store: string };
type ExcludedRow = { id: string; description: string; quantity: string | null; unit: string | null; est_cost: string | null };
type VariationRow = { work_item_id: string; est_at_addition: string | null; note: string | null; created_at: string };

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

  const [{ data: stages }, { data: progress }, { data: materials }, { data: rva }, { data: evRows }, { data: money }, { data: finishRows }, { data: priceRows }] = await Promise.all([
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", b.building_type_id).order("sequence"),
    supabase.from("building_stage_progress").select("stage_id,status,completed_at").eq("building_id", b.id),
    supabase.from("materials_catalog").select("id,name,unit"),
    supabase.from("building_req_vs_actual").select("material_id,required,consumed,overrun").eq("building_id", b.id),
    supabase.from("building_work_ev")
      .select("work_item_id,stage_id,element_name,description,kind,qty_planned,unit,qty_done,unit_cost_live,planned_value,earned_value,boq_amount")
      .eq("building_id", b.id).order("element_name"),
    supabase.from("building_money")
      .select("budget,budget_date,variations_total,spent,earned,remaining,forecast")
      .eq("building_id", b.id).maybeSingle(),
    supabase.from("building_finish_takeoff").select("material_id,qty_needed,in_store").eq("building_id", b.id),
    supabase.from("material_prices").select("material_id,unit_price,effective_from")
      .lte("effective_from", new Date().toISOString().slice(0, 10))
      .order("effective_from", { ascending: false }),
  ]);

  // Excluded (by-others) lines on this recipe + this building's variations.
  const [{ data: excludedRows }, { data: variationRows }] = await Promise.all([
    supabase.from("work_item_cost")
      .select("id,description,quantity,unit,est_cost")
      .eq("building_type_id", b.building_type_id).eq("in_scope", false),
    supabase.from("building_variations")
      .select("work_item_id,est_at_addition,note,created_at")
      .eq("building_id", b.id).order("created_at", { ascending: false }),
  ]);

  const ev = (evRows ?? []) as EvRow[];
  const totalPlanned = ev.filter((r) => r.planned_value != null).reduce((a, r) => a + Number(r.planned_value), 0);
  const totalEarned = ev.filter((r) => r.earned_value != null).reduce((a, r) => a + Number(r.earned_value), 0);
  const pctEarned = totalPlanned > 0 ? Math.round((totalEarned / totalPlanned) * 100) : null;

  // Money card: budget photo (+ variations) vs live spent/earned/forecast.
  const m = (money ?? null) as Money | null;
  const budget = m?.budget != null ? Number(m.budget) : null;
  const variationsTotal = m?.variations_total != null ? Number(m.variations_total) : 0;
  const photoBudget = budget != null ? budget - variationsTotal : null;
  const forecast = m?.forecast != null ? Number(m.forecast) : null;
  const overBy = budget != null && forecast != null ? forecast - budget : null;

  const excludedLines = (excludedRows ?? []) as ExcludedRow[];
  const variations = (variationRows ?? []) as VariationRow[];
  const variedIds = new Set(variations.map((v) => v.work_item_id));
  const addableLines = excludedLines.filter((e) => !variedIds.has(e.id));
  const excludedDesc = (id: string) => excludedLines.find((e) => e.id === id)?.description ?? id;

  // Latest price per material (rows arrive newest-first).
  const prices: Record<string, number> = {};
  for (const p of priceRows ?? [])
    if (prices[p.material_id] === undefined) prices[p.material_id] = Number(p.unit_price);

  // "To finish this house": remaining work → materials, minus what's in store.
  const finish = ((finishRows ?? []) as FinishRow[])
    .map((f) => {
      const needed = Number(f.qty_needed);
      const inStore = Number(f.in_store);
      const buy = Math.max(needed - inStore, 0);
      const price = prices[f.material_id];
      return {
        material_id: f.material_id, needed, inStore, buy,
        cost: price != null ? buy * price : null,
        mat: (materials ?? []).find((x) => x.id === f.material_id),
      };
    })
    .sort((a, b) => (a.mat?.name ?? "").localeCompare(b.mat?.name ?? ""));
  const finishTotal = finish.reduce((a, f) => a + (f.cost ?? 0), 0);
  const loggedCount = ev.filter((r) => r.qty_done != null).length;
  const sparseLogging = ev.length > 0 && loggedCount < ev.length / 2;

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

      {/* Money card — this building as a financial event, judged against its own
          budget photo (the recipe stays a live document). */}
      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">Money</h2>
          {budget != null && overBy != null && (
            overBy > 0
              ? <span className="badge badge-accent">{ngn(overBy)} over budget</span>
              : <span className="badge badge-green">On track</span>
          )}
        </div>
        {budget != null ? (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="stat-label">{variationsTotal > 0 ? "Budget" : `Budget (photo taken ${m?.budget_date ?? "—"})`}</div>
              <div className="mt-1 font-mono text-xl font-semibold text-white">{ngn(budget)}</div>
              {variationsTotal > 0 && (
                <div className="mt-0.5 text-xs text-[#8b95a7]">
                  photo {ngn(photoBudget)} ({m?.budget_date ?? "—"}) + variations {ngn(variationsTotal)}
                </div>
              )}
            </div>
            <div>
              <div className="stat-label">Spent so far</div>
              <div className="mt-1 font-mono text-xl font-semibold text-white">{ngn(m?.spent != null ? Number(m.spent) : 0)}</div>
            </div>
            <div>
              <div className="stat-label">Work done, worth</div>
              <div className="mt-1 font-mono text-xl font-semibold text-emerald-300">{ngn(m?.earned != null ? Number(m.earned) : 0)}</div>
            </div>
            <div>
              <div className="stat-label">Forecast at finish</div>
              <div className={`mt-1 font-mono text-xl font-semibold ${overBy != null && overBy > 0 ? "text-accent-300" : "text-white"}`}>{ngn(forecast)}</div>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-[#8b95a7]">
              The budget is a photo of the recipe&apos;s cost at today&apos;s prices — the recipe stays live; this building remembers its number.
            </p>
            <SnapshotBudgetButton buildingId={b.id} />
          </div>
        )}
      </section>

      {/* Variations — pull by-others work into THIS house only, dated. */}
      {(addableLines.length > 0 || variations.length > 0) && (
        <details className="card p-0 overflow-hidden">
          <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-white">
            Add excluded work to THIS house (variation)
            {variations.length > 0 && <span className="ml-2 badge badge-muted">{variations.length} added</span>}
          </summary>
          <div className="space-y-4 border-t border-white/[0.06] p-5">
            <p className="text-xs text-[#8b95a7]">
              Adds only to this house&apos;s budget, dated — the recipe and other houses are untouched.
            </p>
            <VariationAdder
              buildingId={b.id}
              lines={addableLines.map((l) => ({
                id: l.id, description: l.description,
                quantity: l.quantity != null ? Number(l.quantity) : null,
                unit: l.unit, est_cost: l.est_cost != null ? Number(l.est_cost) : null,
              }))}
            />
            {addableLines.length === 0 && (
              <p className="text-xs text-[#5b6473]">Every excluded line is already on this house.</p>
            )}
            {variations.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-white">On this house</h3>
                <ul className="mt-2 space-y-1.5">
                  {variations.map((v) => (
                    <li key={v.work_item_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 text-[13px] leading-snug text-[#c7cedb]">
                        {excludedDesc(v.work_item_id)}
                        {v.note && <span className="ml-2 text-xs text-[#5b6473]">“{v.note}”</span>}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-[#8b95a7]">
                        {v.est_at_addition != null ? ngn(Number(v.est_at_addition)) : "—"} · {v.created_at.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}

      {/* To finish this house — remaining work → materials, minus store stock. */}
      {finish.length > 0 && (
        <section className="card p-0 overflow-hidden">
          <div className="px-5 pt-5">
            <h2 className="text-sm font-semibold text-white">To finish this house</h2>
            <p className="mt-0.5 text-xs text-[#8b95a7]">
              What the remaining work needs, minus what&apos;s already in store — the buy list to get this building done.
              {sparseLogging && <span className="text-accent-300"> Based on logged work — log progress for accuracy.</span>}
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="table-base min-w-[640px]">
              <thead>
                <tr><th>Material</th><th className="text-right">Needed to finish</th><th className="text-right">In store</th><th className="text-right">Buy</th><th className="text-right">≈ Cost</th></tr>
              </thead>
              <tbody>
                {finish.map((f) => (
                  <tr key={f.material_id}>
                    <td className="text-white">{f.mat?.name ?? f.material_id}</td>
                    <td className="text-right font-mono">{f.needed.toLocaleString("en-NG", { maximumFractionDigits: 2 })} <span className="text-[#8b95a7]">{f.mat?.unit ?? ""}</span></td>
                    <td className="text-right font-mono text-[#8b95a7]">{f.inStore.toLocaleString("en-NG", { maximumFractionDigits: 2 })}</td>
                    <td className={`text-right font-mono ${f.buy > 0 ? "text-white" : "text-[#8b95a7]"}`}>{f.buy.toLocaleString("en-NG", { maximumFractionDigits: 2 })}</td>
                    <td className="text-right font-mono">{f.cost != null ? ngn(f.cost) : <span className="text-[#5b6473]">no price</span>}</td>
                  </tr>
                ))}
                <tr className="border-t border-white/[0.08]">
                  <td className="font-semibold text-white" colSpan={4}>Total to buy</td>
                  <td className="text-right font-mono font-semibold text-white">{ngn(finishTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

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
              <h2 className="text-sm font-semibold text-white">Progress (work done)</h2>
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
