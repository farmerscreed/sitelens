"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconAlert } from "@/components/icons";

type Plan = {
  id: string; name: string; mode: string;
  assumptions: { period_unit?: string; batches?: Record<string, { start: number }> } | null;
  inflows: { period: number; amount: number }[] | null;
  available_cash: number | null;
};
type Line = { id: string; building_type_id: string; quantity: number; target_stage_id: string | null; batch_hint: string | null };
type Type = { id: string; name: string };
type Stage = { id: string; building_type_id: string; name: string; sequence: number };
type Period = { period: number; outflow: number; cumulative: number; inflow: number; net_cumulative: number };

const naira = (n: number) => "₦" + Number(n).toLocaleString();

export function PlanEditor({
  plan, lines, types, stages, result,
}: {
  plan: Plan; lines: Line[]; types: Type[]; stages: Stage[]; result: any;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? id;
  const stagesFor = (typeId: string) => stages.filter((s) => s.building_type_id === typeId);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    if (error) setErr(error.message); else router.refresh();
  }

  const [lt, setLt] = useState(types[0]?.id ?? "");
  const [lq, setLq] = useState(1);
  const [lstage, setLstage] = useState("");
  const [lhint, setLhint] = useState("B1");

  const hints = useMemo(() => [...new Set(lines.map((l) => l.batch_hint).filter(Boolean) as string[])], [lines]);
  const [starts, setStarts] = useState<Record<string, number>>(
    () => Object.fromEntries(hints.map((h) => [h, plan.assumptions?.batches?.[h]?.start ?? 0])),
  );
  async function saveAssumptions() {
    const assumptions = {
      ...(plan.assumptions ?? {}),
      period_unit: plan.assumptions?.period_unit ?? "week",
      batches: Object.fromEntries(hints.map((h) => [h, { start: Number(starts[h] ?? 0) }])),
    };
    await call("fn_update_plan", { p_plan: plan.id, p_assumptions: assumptions });
  }
  const [cash, setCash] = useState(plan.available_cash ?? 0);

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className="mt-1 font-mono text-lg font-semibold text-white">{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-white">{plan.name}</h1>
        <span className="badge badge-accent">{plan.mode.replace("_", "-")}</span>
      </header>

      {/* lines */}
      <section className="card p-0 overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-white">Buildings to deliver</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Line</th><th className="text-right">Batch</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}><td className="text-white">{l.quantity} × {typeName(l.building_type_id)}</td>
                  <td className="text-right text-[#8b95a7]">{l.batch_hint ?? "—"}</td></tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={2} className="py-5 text-center text-[#8b95a7]">No lines yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 p-5 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex-1"><label className="label">Type</label>
            <select className="select" value={lt} onChange={(e) => { setLt(e.target.value); setLstage(""); }}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="sm:w-20"><label className="label">Qty</label>
            <input type="number" min={1} className="input" value={lq} onChange={(e) => setLq(Number(e.target.value))} /></div>
          <div className="flex-1"><label className="label">Target</label>
            <select className="select" value={lstage} onChange={(e) => setLstage(e.target.value)}>
              <option value="">to last stage</option>
              {stagesFor(lt).map((s) => <option key={s.id} value={s.id}>to {s.name}</option>)}</select></div>
          <div className="sm:w-24"><label className="label">Batch</label>
            <input className="input" placeholder="B1" value={lhint} onChange={(e) => setLhint(e.target.value)} /></div>
          <button className="btn btn-primary shrink-0" disabled={busy || !lt}
            onClick={() => call("fn_set_plan_line", { p_plan: plan.id, p_building_type: lt, p_quantity: lq, p_target_stage: lstage || null, p_batch_hint: lhint || null })}><IconPlus className="h-4 w-4" />Add</button>
        </div>
      </section>

      {/* batch starts */}
      {hints.length > 0 && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Batch start ({plan.assumptions?.period_unit ?? "week"}s)</h2>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {hints.map((h) => (
              <div key={h}><label className="label">{h}</label>
                <input type="number" min={0} className="input w-20"
                  value={starts[h] ?? 0} onChange={(e) => setStarts({ ...starts, [h]: Number(e.target.value) })} /></div>
            ))}
            <button className="btn btn-ghost" disabled={busy} onClick={saveAssumptions}>Apply schedule</button>
          </div>
        </section>
      )}

      {/* max-delivery cash */}
      {plan.mode === "max_delivery" && (
        <section className="card">
          <div className="flex flex-wrap items-end gap-3">
            <div><label className="label">Available cash (₦)</label>
              <input type="number" className="input w-48" value={cash} onChange={(e) => setCash(Number(e.target.value))} /></div>
            <button className="btn btn-ghost" disabled={busy}
              onClick={() => call("fn_update_plan", { p_plan: plan.id, p_available_cash: cash })}>Apply cash</button>
          </div>
        </section>
      )}

      {/* results */}
      <section className="card">
        <h2 className="text-sm font-semibold text-white">Result <span className="text-xs font-normal text-[#8b95a7]">— live at current prices</span></h2>
        {!result && <p className="mt-3 text-sm text-[#8b95a7]">Add lines to compute.</p>}

        {result && plan.mode !== "max_delivery" && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Total funding" value={naira(result.total_funding)} />
              <Stat label="Peak period need" value={naira(result.peak_period_requirement)} />
              <Stat label="Peak funding" value={naira(result.peak_funding)} />
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>{result.period_unit ?? "period"}</th><th className="text-right">Need</th><th className="text-right">Cumulative</th><th className="text-right">Inflow</th><th className="text-right">Net</th></tr></thead>
                <tbody>
                  {(result.periods as Period[]).map((p) => (
                    <tr key={p.period}>
                      <td className="text-white">{p.period}</td>
                      <td className="text-right font-mono">{naira(p.outflow)}</td>
                      <td className="text-right font-mono">{naira(p.cumulative)}</td>
                      <td className="text-right font-mono text-[#8b95a7]">{p.inflow ? naira(p.inflow) : "—"}</td>
                      <td className="text-right font-mono">{naira(p.net_cumulative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && plan.mode === "max_delivery" && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Available" value={naira(result.available)} />
              <Stat label="Cost per mix" value={naira(result.mix_cost)} />
              <Stat label="Deliverable mixes" value={String(result.multiplier)} />
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Type</th><th className="text-right">Units</th><th className="text-right">Unit cost</th></tr></thead>
                <tbody>
                  {(result.per_type as { building_type_id: string; per_mix_quantity: number; unit_cost: number }[]).map((t) => (
                    <tr key={t.building_type_id}>
                      <td className="text-white">{typeName(t.building_type_id)}</td>
                      <td className="text-right font-mono">{t.per_mix_quantity * result.multiplier}</td>
                      <td className="text-right font-mono text-[#8b95a7]">{naira(t.unit_cost)}/unit</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
      {err && <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </div>
  );
}
