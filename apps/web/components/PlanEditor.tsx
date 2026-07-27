"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

  // add-line form
  const [lt, setLt] = useState(types[0]?.id ?? "");
  const [lq, setLq] = useState(1);
  const [lstage, setLstage] = useState("");
  const [lhint, setLhint] = useState("B1");

  // batch starts (assumptions)
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

  // max-delivery inputs
  const [cash, setCash] = useState(plan.available_cash ?? 0);

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{plan.name}</h1>
        <span className="text-sm text-neutral-500">{plan.mode.replace("_", "-")}</span>
      </header>

      {/* lines */}
      <section>
        <h2 className="mb-2 text-sm font-medium">Buildings to deliver</h2>
        <table className="w-full text-sm">
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1">{l.quantity} × {typeName(l.building_type_id)}</td>
                <td className="text-neutral-500">{l.batch_hint ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex flex-wrap items-end gap-2 text-sm">
          <select className="rounded border px-2 py-1 dark:bg-neutral-900" value={lt} onChange={(e) => { setLt(e.target.value); setLstage(""); }}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <input type="number" min={1} className="w-20 rounded border px-2 py-1 dark:bg-neutral-900" value={lq} onChange={(e) => setLq(Number(e.target.value))} />
          <select className="rounded border px-2 py-1 dark:bg-neutral-900" value={lstage} onChange={(e) => setLstage(e.target.value)}>
            <option value="">to last stage</option>
            {stagesFor(lt).map((s) => <option key={s.id} value={s.id}>to {s.name}</option>)}
          </select>
          <input className="w-20 rounded border px-2 py-1 dark:bg-neutral-900" placeholder="batch" value={lhint} onChange={(e) => setLhint(e.target.value)} />
          <button className="rounded bg-neutral-900 px-3 py-1 text-white dark:bg-white dark:text-neutral-900" disabled={busy || !lt}
            onClick={() => call("fn_set_plan_line", { p_plan: plan.id, p_building_type: lt, p_quantity: lq, p_target_stage: lstage || null, p_batch_hint: lhint || null })}>Add line</button>
        </div>
      </section>

      {/* batch starts */}
      {hints.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium">Batch start ({plan.assumptions?.period_unit ?? "week"}s)</h2>
          <div className="flex flex-wrap items-end gap-2 text-sm">
            {hints.map((h) => (
              <label key={h}>{h}
                <input type="number" min={0} className="ml-1 w-16 rounded border px-2 py-1 dark:bg-neutral-900"
                  value={starts[h] ?? 0} onChange={(e) => setStarts({ ...starts, [h]: Number(e.target.value) })} />
              </label>
            ))}
            <button className="rounded border px-3 py-1 dark:border-neutral-700" disabled={busy} onClick={saveAssumptions}>Apply schedule</button>
          </div>
        </section>
      )}

      {/* max-delivery cash */}
      {plan.mode === "max_delivery" && (
        <section className="flex items-end gap-2 text-sm">
          <label>Available cash
            <input type="number" className="ml-1 w-40 rounded border px-2 py-1 dark:bg-neutral-900" value={cash} onChange={(e) => setCash(Number(e.target.value))} />
          </label>
          <button className="rounded border px-3 py-1 dark:border-neutral-700" disabled={busy}
            onClick={() => call("fn_update_plan", { p_plan: plan.id, p_available_cash: cash })}>Apply cash</button>
        </section>
      )}

      {/* results */}
      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-3 text-sm font-medium">Result (live at current prices)</h2>
        {!result && <p className="text-sm text-neutral-500">Add lines to compute.</p>}

        {result && plan.mode !== "max_delivery" && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-6 text-sm">
              <div><div className="text-neutral-500">Total funding</div><div className="font-mono text-lg">{naira(result.total_funding)}</div></div>
              <div><div className="text-neutral-500">Peak period need</div><div className="font-mono text-lg">{naira(result.peak_period_requirement)}</div></div>
              <div><div className="text-neutral-500">Peak funding (cumulative)</div><div className="font-mono text-lg">{naira(result.peak_funding)}</div></div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
                  <th className="py-1">{result.period_unit ?? "period"}</th><th className="text-right">Need</th>
                  <th className="text-right">Cumulative</th><th className="text-right">Inflow</th><th className="text-right">Net</th>
                </tr>
              </thead>
              <tbody>
                {(result.periods as Period[]).map((p) => (
                  <tr key={p.period} className="border-b border-neutral-100 dark:border-neutral-900">
                    <td className="py-1">{p.period}</td>
                    <td className="text-right font-mono">{naira(p.outflow)}</td>
                    <td className="text-right font-mono">{naira(p.cumulative)}</td>
                    <td className="text-right font-mono text-neutral-500">{p.inflow ? naira(p.inflow) : "—"}</td>
                    <td className="text-right font-mono">{naira(p.net_cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result && plan.mode === "max_delivery" && (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-6">
              <div><div className="text-neutral-500">Available</div><div className="font-mono text-lg">{naira(result.available)}</div></div>
              <div><div className="text-neutral-500">Cost per mix</div><div className="font-mono text-lg">{naira(result.mix_cost)}</div></div>
              <div><div className="text-neutral-500">Deliverable mixes</div><div className="font-mono text-lg">{result.multiplier}</div></div>
            </div>
            <table className="w-full">
              <tbody>
                {(result.per_type as { building_type_id: string; per_mix_quantity: number; unit_cost: number }[]).map((t) => (
                  <tr key={t.building_type_id} className="border-b border-neutral-100 dark:border-neutral-900">
                    <td className="py-1">{typeName(t.building_type_id)}</td>
                    <td className="text-right font-mono">{t.per_mix_quantity * result.multiplier} units</td>
                    <td className="text-right font-mono text-neutral-500">{naira(t.unit_cost)}/unit</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </main>
  );
}
