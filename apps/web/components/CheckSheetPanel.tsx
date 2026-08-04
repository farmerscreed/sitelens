"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

export type CheckRow = {
  label: string; unit: string | null; qty: number | null; amount: number | null; section: string | null;
};
type Draft = CheckRow & { on: boolean };

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

// A schedule/summary sheet is the workbook's own ANSWER KEY — the quantities and
// totals its author computed from the same bills. Captured here (human-confirmed,
// Rule 3) they become check values the recipe page compares LIVE against the
// computed take-off (type_takeoff_check). They are never imported as work or
// prices — they exist to grade the recipe, exactly as reconciliation grades the
// extraction.
export function CheckSheetPanel({
  buildingTypeId, sheetName, role, rows,
}: { buildingTypeId: string; sheetName: string; role: string; rows: CheckRow[] }) {
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Draft[]>(rows.map((r) => ({ ...r, on: true })));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const patch = (i: number, p: Partial<Draft>) =>
    setDrafts((s) => s.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const selected = drafts.filter((d) => d.on && d.label.trim() && (d.qty != null || d.amount != null));

  async function capture() {
    setBusy(true); setMsg(null);
    const p_rows = selected.map((d) => ({
      label: d.label.trim(), unit: d.unit ?? "", qty: d.qty ?? "", amount: d.amount ?? "",
      section: d.section ?? "",
    }));
    const { data, error } = await supabase.rpc("fn_set_boq_check_values", {
      p_type: buildingTypeId, p_sheet: sheetName, p_rows,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else {
      setMsg({ ok: true, t: `${data} check value(s) captured — the recipe page now grades the take-off against them.` });
      setDone(true);
    }
  }

  if (rows.length === 0) return null;

  return (
    <details open className="card p-0 overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 text-sm">
        <span className="font-semibold text-white">{role === "summary" ? "Summary" : "Schedule"} sheet: “{sheetName}”</span>
        <span className="ml-3 text-[#8b95a7]">{rows.length} check value(s) found</span>
      </summary>
      <div className="border-t border-white/[0.06] p-4">
        <p className="text-sm text-[#c7cedb]">
          The workbook&apos;s own {role === "summary" ? "totals" : "quantities"} — captured as{" "}
          <strong className="text-white">cross-check values</strong>, not imported as data. The recipe compares its
          computed take-off against them live, so you see at once whether the recipe reproduces the workbook.
        </p>
        {msg && (
          <div className={`mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
            msg.ok ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                   : "border-red-500/20 bg-red-500/[0.06] text-red-300"}`}>
            {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}
            <span>{msg.t}{msg.ok && <> <Link className="underline underline-offset-2" href={`/recipes/${buildingTypeId}`}>Open the recipe →</Link></>}</span>
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="table-base min-w-[640px]">
            <thead>
              <tr><th>Keep</th><th className="min-w-[18rem]">As stated in the sheet</th><th>Unit</th><th className="text-right">Qty</th><th className="text-right">Amount (₦)</th></tr>
            </thead>
            <tbody>
              {drafts.map((d, i) => (
                <tr key={`${d.label}-${i}`}>
                  <td><input type="checkbox" checked={d.on} disabled={busy || done} onChange={(e) => patch(i, { on: e.target.checked })}
                    className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" /></td>
                  <td className="max-w-[22rem] whitespace-normal text-[13px] leading-snug text-white">
                    {d.label}
                    {d.section && <div className="text-[10px] text-[#5b6473]">{d.section}</div>}
                  </td>
                  <td className="text-[#8b95a7]">{d.unit ?? "—"}</td>
                  <td className="text-right">
                    {d.qty != null ? (
                      <input type="number" step="0.001" className="input w-28 py-1.5 text-right" value={d.qty} disabled={busy || done}
                        onChange={(e) => patch(i, { qty: e.target.value === "" ? null : Number(e.target.value) })} />
                    ) : "—"}
                  </td>
                  <td className="text-right font-mono text-xs text-[#c7cedb]">{d.amount != null ? ngn(d.amount) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-primary mt-3" disabled={busy || done || selected.length === 0} onClick={capture}>
          <IconCheck className="h-4 w-4" />
          {busy ? "Capturing…" : `Capture ${selected.length} check value${selected.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </details>
  );
}
