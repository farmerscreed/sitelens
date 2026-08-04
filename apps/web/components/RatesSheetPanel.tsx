"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

export type RateRow = { label: string; unit: string | null; value: number; note: string | null; kind: string };
type Material = { id: string; name: string; unit: string };
type PriceDraft = {
  on: boolean; label: string; name: string; unit: string; price: string;
  materialId: string | null;   // null → will be created on confirm
};

const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

// "Cement, 50kg bag (trailer-load pricing)" → "Cement, 50kg bag";
// "Sharp sand, per m3 (20t tipper…)" → "Sharp sand". The human edits anyway.
function cleanName(label: string): string {
  return label
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/,?\s*per\s+\S+.*$/i, "")
    .replace(/,\s*(delivered|supplied|fixed).*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const tokens = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
function fuzzyMatch(label: string, materials: Material[]): Material | null {
  const lt = tokens(label);
  let best: Material | null = null; let bestScore = 0;
  for (const m of materials) {
    let score = 0;
    for (const t of tokens(m.name)) if (lt.has(t)) score++;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  return bestScore >= 1 ? best : null;
}

// A workbook's rates/build-ups sheet, turned into review candidates:
//  • section-A material input prices → the price book (fn_upsert_material +
//    fn_set_material_price — the same server write paths as everywhere else).
//    These are GENUINE delivered prices, not all-in rates, so unlike bill rates
//    they belong in material_prices (§7 respected, not bypassed).
//  • labour rates and derived build-ups → reference proposals on /ai
//    (fn_record_inference) — they inform assemblies, they never touch prices.
// Everything is editable and nothing is written until the human confirms (Rule 3).
export function RatesSheetPanel({ orgId, sheetName, rows, onDone }: { orgId: string; sheetName: string; rows: RateRow[]; onDone?: () => void }) {
  const supabase = createClient();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [refDone, setRefDone] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const priceRows = useMemo(() => rows.filter((r) => r.kind === "price"), [rows]);
  const refRows = useMemo(() => rows.filter((r) => r.kind === "labour" || r.kind === "buildup"), [rows]);
  const [drafts, setDrafts] = useState<PriceDraft[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const [{ data: mats }, { data: priceData }] = await Promise.all([
        supabase.from("materials_catalog").select("id,name,unit").order("name"),
        supabase.from("material_prices").select("material_id,unit_price,effective_from")
          .lte("effective_from", new Date().toISOString().slice(0, 10))
          .order("effective_from", { ascending: false }),
      ]);
      if (!live) return;
      const m = (mats ?? []) as Material[];
      setMaterials(m);
      const p: Record<string, number> = {};
      for (const row of priceData ?? []) if (p[row.material_id] === undefined) p[row.material_id] = Number(row.unit_price);
      setPrices(p);
      setDrafts(priceRows.map((r) => {
        const match = fuzzyMatch(r.label, m);
        return {
          on: true, label: r.label, name: match?.name ?? cleanName(r.label),
          unit: match?.unit ?? r.unit ?? "", price: String(r.value), materialId: match?.id ?? null,
        };
      }));
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priceRows]);

  const patch = (i: number, p: Partial<PriceDraft>) =>
    setDrafts((s) => s.map((d, j) => (j === i ? { ...d, ...p } : d)));
  const selected = drafts.filter((d) => d.on && d.name.trim() && d.price !== "" && Number(d.price) > 0);

  async function confirmPrices() {
    setBusy(true); setMsg(null);
    try {
      let created = 0, priced = 0;
      for (const d of selected) {
        let mid = d.materialId;
        if (!mid) {
          const { data, error } = await supabase.rpc("fn_upsert_material", {
            p_org: orgId, p_name: d.name.trim(), p_unit: d.unit.trim() || "unit",
          });
          if (error) throw new Error(`creating material "${d.name}": ${error.message}`);
          mid = data as string; created++;
        }
        const { error: pErr } = await supabase.rpc("fn_set_material_price", {
          p_org: orgId, p_material: mid, p_unit_price: Number(d.price),
        });
        if (pErr) throw new Error(`price for "${d.name}": ${pErr.message}`);
        priced++;
      }
      setMsg({ ok: true, t: `Set ${priced} price(s)${created ? `, created ${created} material(s)` : ""} from “${sheetName}”.` });
      setDone(true);
      onDone?.();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function fileReferences() {
    setBusy(true); setMsg(null);
    try {
      for (const r of refRows) {
        const { error } = await supabase.rpc("fn_record_inference", {
          p_org: orgId,
          p_subject_type: r.kind === "labour" ? "labour_rate_reference" : "rate_buildup_reference",
          p_output: { label: r.label, unit: r.unit, value: r.value, note: r.note, sheet: sheetName },
        });
        if (error) throw new Error(error.message);
      }
      setMsg({ ok: true, t: `${refRows.length} labour/build-up row(s) filed as reference proposals — see the AI proposals page.` });
      setRefDone(true);
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (priceRows.length === 0 && refRows.length === 0) return null;

  return (
    <details open className="card p-0 overflow-hidden">
      <summary className="cursor-pointer px-4 py-3 text-sm">
        <span className="font-semibold text-white">Rates sheet: “{sheetName}”</span>
        <span className="ml-3 text-[#8b95a7]">{priceRows.length} input price(s) · {refRows.length} labour/build-up row(s)</span>
      </summary>
      <div className="border-t border-white/[0.06] p-4">
        {msg && (
          <div className={`mb-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
            msg.ok ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                   : "border-red-500/20 bg-red-500/[0.06] text-red-300"}`}>
            {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
          </div>
        )}

        {priceRows.length > 0 && (
          <>
            <p className="text-sm text-[#c7cedb]">
              These are the sheet&apos;s <strong className="text-white">material input prices</strong> — genuine delivered
              prices (not all-in bill rates), so they can seed your price book. Matched materials update; unmatched ones
              are created. Edit anything first.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base min-w-[760px]">
                <thead>
                  <tr><th>Set</th><th className="min-w-[16rem]">As priced in the sheet</th><th className="min-w-[12rem]">Catalog material</th><th>Unit</th><th>Price (₦)</th><th className="text-right">Current</th></tr>
                </thead>
                <tbody>
                  {drafts.map((d, i) => (
                    <tr key={d.label}>
                      <td><input type="checkbox" checked={d.on} disabled={busy || done} onChange={(e) => patch(i, { on: e.target.checked })}
                        className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" /></td>
                      <td className="max-w-[20rem] whitespace-normal text-[13px] leading-snug text-[#8b95a7]">{d.label}</td>
                      <td>
                        <select className="select py-1.5" value={d.materialId ?? "__new__"} disabled={busy || done}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__new__") patch(i, { materialId: null, name: cleanName(d.label) });
                            else {
                              const m = materials.find((x) => x.id === v);
                              patch(i, { materialId: v, name: m?.name ?? d.name, unit: m?.unit ?? d.unit });
                            }
                          }}>
                          <option value="__new__">+ create: {cleanName(d.label)}</option>
                          {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                        </select>
                        {d.materialId == null && (
                          <input className="input mt-1 py-1.5" value={d.name} disabled={busy || done}
                            onChange={(e) => patch(i, { name: e.target.value })} />
                        )}
                      </td>
                      <td><input className="input w-20 py-1.5" value={d.unit} disabled={busy || done || d.materialId != null}
                        onChange={(e) => patch(i, { unit: e.target.value })} /></td>
                      <td><input type="number" min="0" className="input w-28 py-1.5" value={d.price} disabled={busy || done}
                        onChange={(e) => patch(i, { price: e.target.value })} /></td>
                      <td className="text-right font-mono text-xs text-[#8b95a7]">
                        {d.materialId && prices[d.materialId] != null ? ngn(prices[d.materialId]) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-primary mt-3" disabled={busy || done || selected.length === 0} onClick={confirmPrices}>
              <IconCheck className="h-4 w-4" />
              {busy ? "Setting…" : `Set ${selected.length} price${selected.length === 1 ? "" : "s"} in my price book`}
            </button>
          </>
        )}

        {refRows.length > 0 && (
          <div className="mt-5">
            <p className="text-sm text-[#c7cedb]">
              Labour rates and derived build-ups are <strong className="text-white">reference figures</strong> — they inform
              assembly labour rates and mixes, and are <strong className="text-white">never</strong> prices. File them so
              they&apos;re on record when you build assemblies.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="table-base min-w-[560px]">
                <thead><tr><th>Kind</th><th className="min-w-[18rem]">Row</th><th>Unit</th><th className="text-right">₦</th><th>Note</th></tr></thead>
                <tbody>
                  {refRows.map((r) => (
                    <tr key={r.label}>
                      <td><span className={`badge ${r.kind === "labour" ? "badge-blue" : "badge-accent"}`}>{r.kind}</span></td>
                      <td className="max-w-[22rem] whitespace-normal text-[13px] leading-snug text-[#8b95a7]">{r.label}</td>
                      <td className="text-[#8b95a7]">{r.unit ?? "—"}</td>
                      <td className="text-right font-mono text-xs text-[#c7cedb]">{ngn(r.value)}</td>
                      <td className="max-w-[16rem] whitespace-normal text-xs text-[#5b6473]">{r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn btn-ghost mt-3" disabled={busy || refDone} onClick={fileReferences}>
              {refDone ? "Filed" : busy ? "Filing…" : `File ${refRows.length} as reference proposals`}
            </button>
          </div>
        )}
      </div>
    </details>
  );
}
