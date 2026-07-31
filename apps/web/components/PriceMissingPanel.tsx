"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

type Material = { id: string; name: string; unit: string };
type Item = {
  id: string; kind: string; description: string;
  quantity: number | null; unit: string | null; material_id: string | null;
};
type Draft = { matSel: string; newName: string; newUnit: string; price: string; rate: string };

// Best catalog guess for a bill line: the material whose name-words appear most
// in the description (display convenience only — the human picks).
function bestMatch(materials: Material[], description: string): Material | null {
  const d = description.toLowerCase();
  let best: Material | null = null; let bestScore = 0;
  for (const m of materials) {
    const words = m.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
    const score = words.filter((w) => d.includes(w)).length;
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return best;
}

// "K items have no price — give each one": the missing write-path UI for lines
// no estimate can reach. Supply/fittings get a catalog material + a price
// (fn_upsert_material → fn_set_material_price → fn_update_work_item); labour/
// plant get an agreed rate stored as a labour-only mix (fn_upsert_assembly →
// fn_update_work_item). All server functions, all human-entered (Rules 1 & 3).
export function PriceMissingPanel({ orgId, materials, items }: {
  orgId: string; materials: Material[]; items: Item[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const d: Record<string, Draft> = {};
    for (const it of items) {
      const match = it.material_id ? materials.find((m) => m.id === it.material_id) ?? null : bestMatch(materials, it.description);
      d[it.id] = {
        matSel: match?.id ?? "__new__",
        newName: it.description.slice(0, 40).trim(),
        newUnit: it.unit ?? "",
        price: "", rate: "",
      };
    }
    return d;
  });
  const patch = (id: string, p: Partial<Draft>) =>
    setDrafts((s) => ({ ...s, [id]: { ...s[id], ...p } }));

  const isMaterialKind = (k: string) => k === "fitting" || k === "material_supply";
  const isRateKind = (k: string) => k === "labour" || k === "plant";
  const filled = (it: Item) => {
    const d = drafts[it.id];
    if (!d) return false;
    if (isMaterialKind(it.kind)) return d.price !== "" && Number(d.price) > 0 && (d.matSel !== "__new__" || (d.newName.trim() !== "" && d.newUnit.trim() !== ""));
    if (isRateKind(it.kind)) return d.rate !== "" && Number(d.rate) > 0;
    return false;
  };

  async function applyOne(it: Item) {
    const d = drafts[it.id];
    if (isMaterialKind(it.kind)) {
      let mat = d.matSel;
      if (mat === "__new__") {
        const { data, error } = await supabase.rpc("fn_upsert_material", {
          p_org: orgId, p_name: d.newName.trim(), p_unit: d.newUnit.trim() || it.unit || "unit",
        });
        if (error) throw new Error(`creating "${d.newName}": ${error.message}`);
        mat = data as string;
      }
      const { error: pErr } = await supabase.rpc("fn_set_material_price", {
        p_org: orgId, p_material: mat, p_unit_price: Number(d.price),
      });
      if (pErr) throw new Error(pErr.message);
      const { error: uErr } = await supabase.rpc("fn_update_work_item", {
        p_work_item: it.id, p_kind: null, p_assembly: null, p_material: mat,
      });
      if (uErr) throw new Error(uErr.message);
    } else if (isRateKind(it.kind)) {
      const { data: aid, error: aErr } = await supabase.rpc("fn_upsert_assembly", {
        p_org: orgId, p_name: `Rate: ${it.description.slice(0, 40).trim()}`,
        p_unit: it.unit ?? "unit", p_kind: "custom", p_ratio: null, p_dry_factor: 1,
        p_labour_rate: Number(d.rate), p_plant_rate: null, p_alt_group: null, p_components: [],
      });
      if (aErr) throw new Error(aErr.message);
      const { error: uErr } = await supabase.rpc("fn_update_work_item", {
        p_work_item: it.id, p_kind: null, p_assembly: aid as string, p_material: null,
      });
      if (uErr) throw new Error(uErr.message);
    }
  }

  async function apply(it: Item) {
    setBusy(true); setErr(null); setOk(null);
    try { await applyOne(it); setOk("Price saved."); router.refresh(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function applyAllFilled() {
    setBusy(true); setErr(null); setOk(null);
    let n = 0;
    try {
      for (const it of items) if (filled(it)) { await applyOne(it); n++; }
      setOk(`${n} price(s) saved.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      if (n > 0) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return null;
  const filledCount = items.filter(filled).length;

  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm text-[#c7cedb]">
        {items.length} item{items.length === 1 ? "" : "s"} have no price — give each one.
      </p>
      {ok && <p className="flex items-center gap-1.5 text-sm text-emerald-300"><IconCheck className="h-4 w-4" />{ok}</p>}
      {err && <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}

      <ul className="space-y-2">
        {items.map((it) => {
          const d = drafts[it.id];
          return (
            <li key={it.id} className="rounded-lg bg-white/[0.02] px-3 py-2.5">
              <p className="text-[13px] leading-snug text-[#c7cedb]">
                {it.description}
                {it.quantity != null && (
                  <span className="ml-2 text-xs text-[#5b6473]">
                    {it.quantity.toLocaleString("en-NG")} {it.unit ?? ""}
                  </span>
                )}
              </p>

              {isMaterialKind(it.kind) && d && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="min-w-[14rem] flex-1">
                    <label className="label">Material</label>
                    <select className="select py-1.5" value={d.matSel} disabled={busy}
                      onChange={(e) => patch(it.id, { matSel: e.target.value })}>
                      <option value="__new__">+ create new: {d.newName || "…"}</option>
                      {materials.map((m) => <option key={m.id} value={m.id}>{m.name} (per {m.unit})</option>)}
                    </select>
                  </div>
                  {d.matSel === "__new__" && (
                    <>
                      <div className="min-w-[12rem]">
                        <label className="label">New material name</label>
                        <input className="input py-1.5" value={d.newName} disabled={busy}
                          onChange={(e) => patch(it.id, { newName: e.target.value })} />
                      </div>
                      <div className="w-20">
                        <label className="label">Unit</label>
                        <input className="input py-1.5" placeholder={it.unit ?? "unit"} value={d.newUnit} disabled={busy}
                          onChange={(e) => patch(it.id, { newUnit: e.target.value })} />
                      </div>
                    </>
                  )}
                  <div className="w-32">
                    <label className="label">Price (₦ per unit)</label>
                    <input type="number" min="0" className="input py-1.5" placeholder="0" value={d.price} disabled={busy}
                      onChange={(e) => patch(it.id, { price: e.target.value })} />
                  </div>
                  <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy || !filled(it)} onClick={() => apply(it)}>
                    Apply
                  </button>
                </div>
              )}

              {isRateKind(it.kind) && d && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-44">
                    <label className="label">Agreed rate (₦ per {it.unit ?? "unit"})</label>
                    <input type="number" min="0" className="input py-1.5" placeholder="0" value={d.rate} disabled={busy}
                      onChange={(e) => patch(it.id, { rate: e.target.value })} />
                  </div>
                  <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy || !filled(it)} onClick={() => apply(it)}>
                    Apply
                  </button>
                </div>
              )}

              {!isMaterialKind(it.kind) && !isRateKind(it.kind) && (
                <p className="mt-1 text-xs text-[#8b95a7]">
                  {it.kind === "composite" ? "needs a Mix — see Mixes below" : "set its type first (above), then the price input appears here"}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <button className="btn btn-primary" disabled={busy || filledCount === 0} onClick={applyAllFilled}>
        {busy ? "Saving…" : `Apply all filled (${filledCount})`}
      </button>
    </div>
  );
}
