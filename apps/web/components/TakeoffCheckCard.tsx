"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert } from "@/components/icons";

export type CheckViewRow = {
  id: string; source_sheet: string; section: string | null; label: string;
  unit: string | null; stated_qty: string | null; stated_amount: string | null;
  material_id: string | null; stated_qty_converted: string | null;
  computed_qty: string | null; variance_pct: string | null;
};
type Material = { id: string; name: string; unit: string };

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
const num = (s: string | null) => (s == null ? null : Number(s));

function varianceBadge(v: number) {
  const cls = Math.abs(v) <= 10 ? "badge-green" : Math.abs(v) <= 25 ? "badge-accent" : "badge-red";
  return <span className={`badge ${cls}`}>{v > 0 ? "+" : ""}{v}%</span>;
}

// The workbook grades the recipe: its own schedule/summary figures (captured at
// import) against the recipe's LIVE take-off and estimate. Variance is computed
// in the DB view (type_takeoff_check); a NULL variance is surfaced as "not
// comparable yet", never guessed. Mapping a row is the one action here — a
// human decision through the server write path (Rule 3 / Rule 1).
export function TakeoffCheckCard({
  rows, materials, estTotal,
}: { rows: CheckViewRow[]; materials: Material[]; estTotal: number }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const qtyRows = rows.filter((r) => r.stated_qty != null);
  const moneyRows = rows.filter((r) => r.stated_amount != null);
  if (rows.length === 0) return null;

  async function mapRow(id: string, materialId: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_map_boq_check_value", {
      p_id: id, p_material: materialId || null,
    });
    setBusy(false);
    if (error) setErr(error.message); else router.refresh();
  }

  return (
    <section className="card p-0 overflow-hidden">
      <div className="px-5 pt-5">
        <h2 className="text-sm font-semibold text-white">Cross-check vs the workbook</h2>
        <p className="mt-0.5 text-xs text-[#8b95a7]">
          The imported workbook&apos;s own schedule and totals, compared live against this recipe&apos;s take-off and
          estimate. If the recipe reproduces the workbook, these agree; where they don&apos;t, one of the two is wrong —
          and now you can see it.
        </p>
        {err && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
      </div>

      {qtyRows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="table-base min-w-[820px]">
            <thead>
              <tr><th className="min-w-[16rem]">Workbook says</th><th className="text-right">Stated</th><th className="text-right">Recipe take-off</th><th>Variance</th><th className="min-w-[12rem]">Material</th></tr>
            </thead>
            <tbody>
              {qtyRows.map((r) => {
                const v = num(r.variance_pct);
                const computed = num(r.computed_qty);
                const m = materials.find((x) => x.id === r.material_id);
                return (
                  <tr key={r.id}>
                    <td className="text-white">
                      <div className="max-w-[22rem] whitespace-normal text-[13px] leading-snug">{r.label}</div>
                      <div className="mt-0.5 text-[10px] text-[#5b6473]">{r.source_sheet}{r.section ? ` · ${r.section}` : ""}</div>
                    </td>
                    <td className="text-right font-mono">
                      {Number(r.stated_qty).toLocaleString("en-NG", { maximumFractionDigits: 2 })} <span className="text-[#8b95a7]">{r.unit ?? ""}</span>
                    </td>
                    <td className="text-right font-mono">
                      {computed != null
                        ? <>{computed.toLocaleString("en-NG", { maximumFractionDigits: 2 })} <span className="text-[#8b95a7]">{m?.unit ?? ""}</span></>
                        : <span className="text-xs text-[#5b6473]">—</span>}
                    </td>
                    <td>
                      {v != null ? varianceBadge(v) : (
                        <span className="text-xs text-[#5b6473]">
                          {r.material_id == null ? "map a material →" : computed == null ? "nothing in take-off yet" : "unit bridge missing"}
                        </span>
                      )}
                    </td>
                    <td>
                      <select className="select py-1.5" value={r.material_id ?? ""} disabled={busy}
                        onChange={(e) => mapRow(r.id, e.target.value)}>
                        <option value="">— unmapped —</option>
                        {materials.map((mm) => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {moneyRows.length > 0 && (
        <div className="border-t border-white/[0.06] px-5 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8b95a7]">Workbook stated totals</h3>
          <p className="mt-0.5 text-[11px] text-[#5b6473]">Recipe&apos;s live estimate today: <span className="font-mono text-[#c7cedb]">{ngn(estTotal)}</span></p>
          <table className="table-base mt-2">
            <tbody>
              {moneyRows.map((r) => {
                const amt = num(r.stated_amount)!;
                const isTotal = /base|grand|total/i.test(r.label);
                const v = isTotal && estTotal > 0 ? Math.round(((estTotal - amt) / amt) * 1000) / 10 : null;
                return (
                  <tr key={r.id}>
                    <td className="text-white">
                      <span className="text-[13px]">{r.label}</span>
                      <span className="ml-2 text-[10px] text-[#5b6473]">{r.source_sheet}</span>
                    </td>
                    <td className="text-right font-mono text-[#c7cedb]">{ngn(amt)}</td>
                    <td className="w-28 text-right">{v != null && varianceBadge(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
