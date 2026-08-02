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

const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();
const nairaShort = (n: number) => {
  const v = Number(n);
  if (v >= 1e9) return "₦" + (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return "₦" + Math.round(v / 1e6) + "M";
  if (v >= 1e3) return "₦" + Math.round(v / 1e3) + "k";
  return "₦" + Math.round(v);
};

// top-rounded bar anchored to the baseline (data-end rounded, flat bottom).
function barPath(x: number, yTop: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  const b = yTop + h;
  return `M${x},${b} L${x},${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} `
       + `L${x + w - rr},${yTop} Q${x + w},${yTop} ${x + w},${yTop + rr} L${x + w},${b} Z`;
}

// Cash-need-per-period: one series, one hue (the amber accent), peak highlighted,
// per-bar hover. Cumulative/net live in the detail table (never a second y-axis).
function CashflowChart({ periods, unit }: { periods: Period[]; unit: string }) {
  if (!periods.length) return null;
  const max = Math.max(...periods.map((p) => p.outflow), 1);
  const peakIdx = periods.reduce((mi, p, i, a) => (p.outflow > a[mi].outflow ? i : mi), 0);
  const H = 220, padT = 26, padB = 26, plotH = H - padT - padB;
  const step = 46, gap = 14, barW = step - gap;
  const W = periods.length * step;
  const base = padT + plotH;
  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cash need per period" className="min-w-full">
        <defs>
          <linearGradient id="cf-bar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fab323" /><stop offset="100%" stopColor="#d97706" />
          </linearGradient>
        </defs>
        <line x1="0" y1={base + 0.5} x2={W} y2={base + 0.5} stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
        {periods.map((p, i) => {
          const h = p.outflow > 0 ? Math.max((p.outflow / max) * plotH, 3) : 0;
          const x = i * step + gap / 2;
          const isPeak = i === peakIdx && p.outflow > 0;
          return (
            <g key={p.period}>
              {h > 0 && (
                <path d={barPath(x, base - h, barW, h, 4)} fill={isPeak ? "#ffd257" : "url(#cf-bar)"}>
                  <title>{`${unit} ${p.period} · ${naira(p.outflow)}`}</title>
                </path>
              )}
              {isPeak && (
                <text x={x + barW / 2} y={base - h - 8} textAnchor="middle" fontSize="11" fontWeight="600" fill="#ffd257">{nairaShort(p.outflow)}</text>
              )}
              <text x={x + barW / 2} y={base + 16} textAnchor="middle" fontSize="10" fill="#8b95a7">{p.period}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

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
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? id;
  const stagesFor = (typeId: string) => stages.filter((s) => s.building_type_id === typeId).sort((a, b) => a.sequence - b.sequence);

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
  const unit = result?.period_unit ?? plan.assumptions?.period_unit ?? "week";

  const Stat = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="stat-label">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${accent ? "text-accent-300" : "text-white"}`}>{value}</div>
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{plan.name}</h1>
          <p className="mt-0.5 text-sm text-[#8b95a7]">
            {plan.mode === "max_delivery" ? "How far a fixed budget goes." : "What cash you need, and when — live at today's prices."}
          </p>
        </div>
        <span className="badge badge-accent">{plan.mode.replace("_", "-")}</span>
      </header>

      {/* Buildings to deliver */}
      <section className="card p-0 overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-white">Buildings to deliver</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Buildings</th><th>Target</th><th>Batch</th><th className="text-right">Remove</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="font-medium text-white">{l.quantity} × {typeName(l.building_type_id)}</td>
                  <td className="text-[#c7cedb]">{l.target_stage_id ? `to ${stageName(l.target_stage_id)}` : "full house"}</td>
                  <td className="text-[#8b95a7]">{l.batch_hint ?? "—"}</td>
                  <td className="text-right">
                    <button className="btn btn-ghost px-2.5 py-1 text-xs" disabled={busy} aria-label="Remove line"
                      onClick={() => call("fn_delete_plan_line", { p_plan: plan.id, p_line: l.id })}>✕</button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 && <tr><td colSpan={4} className="py-5 text-center text-[#8b95a7]">No buildings yet — add one below.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-2 border-t border-white/[0.06] p-5 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex-1 min-w-[10rem]"><label className="label">Building type</label>
            <select className="select" value={lt} onChange={(e) => { setLt(e.target.value); setLstage(""); }}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="sm:w-20"><label className="label">Qty</label>
            <input type="number" min={1} className="input" value={lq} onChange={(e) => setLq(Number(e.target.value))} /></div>
          <div className="flex-1 min-w-[10rem]"><label className="label">Build up to (recipe stage)</label>
            <select className="select" value={lstage} onChange={(e) => setLstage(e.target.value)}>
              <option value="">Full house (all stages)</option>
              {stagesFor(lt).map((s) => <option key={s.id} value={s.id}>to {s.name}</option>)}</select></div>
          <div className="sm:w-24"><label className="label">Batch</label>
            <input className="input" placeholder="B1" value={lhint} onChange={(e) => setLhint(e.target.value)} /></div>
          <button className="btn btn-primary shrink-0" disabled={busy || !lt}
            onClick={() => call("fn_set_plan_line", { p_plan: plan.id, p_building_type: lt, p_quantity: lq, p_target_stage: lstage || null, p_batch_hint: lhint || null })}><IconPlus className="h-4 w-4" />Add</button>
        </div>
      </section>

      {/* Batch schedule */}
      {hints.length > 0 && plan.mode !== "max_delivery" && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Batch start</h2>
          <p className="mt-0.5 text-xs text-[#8b95a7]">Which {unit} each batch begins — stagger them to lower the peak. Remove a batch by deleting its buildings above.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            {hints.map((h) => (
              <div key={h}><label className="label">{h} — start {unit}</label>
                <input type="number" min={0} className="input w-24"
                  value={starts[h] ?? 0} onChange={(e) => setStarts({ ...starts, [h]: Number(e.target.value) })} /></div>
            ))}
            <button className="btn btn-ghost" disabled={busy} onClick={saveAssumptions}>Apply schedule</button>
          </div>
        </section>
      )}

      {/* Max-delivery cash */}
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

      {/* Result */}
      {!result && <section className="card"><p className="text-sm text-[#8b95a7]">Add a building to compute the plan.</p></section>}

      {result && plan.mode !== "max_delivery" && (
        <section className="card space-y-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Total funding" value={naira(result.total_funding)} />
            <Stat label={`Peak ${unit} need`} value={naira(result.peak_period_requirement)} accent />
            <Stat label="Peak funding (net)" value={naira(result.peak_funding)} />
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold text-white">Cash needed per {unit}</h2>
              <span className="text-xs text-[#8b95a7]">peak highlighted · hover a bar</span>
            </div>
            <CashflowChart periods={result.periods as Period[]} unit={unit} />
          </div>
          <details className="border-t border-white/[0.06] pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[#8b95a7]">Period-by-period detail</summary>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>{unit}</th><th className="text-right">Need</th><th className="text-right">Cumulative</th><th className="text-right">Inflow</th><th className="text-right">Net</th></tr></thead>
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
          </details>
        </section>
      )}

      {result && plan.mode === "max_delivery" && (
        <section className="card space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Available" value={naira(result.available)} />
            <Stat label="Cost per set" value={naira(result.mix_cost)} />
            <Stat label="Sets you can finish" value={String(result.multiplier)} accent />
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Type</th><th className="text-right">Units delivered</th><th className="text-right">Unit cost</th></tr></thead>
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
        </section>
      )}

      {err && <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </div>
  );
}
