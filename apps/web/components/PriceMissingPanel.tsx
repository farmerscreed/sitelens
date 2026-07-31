"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

type Material = { id: string; name: string; unit: string };
type Item = {
  id: string; kind: string; description: string; element_name: string | null;
  quantity: number | null; unit: string | null; material_id: string | null;
};
type PricedLine = { description: string; boq_rate: number; unit: string | null; element_name: string | null };
type Draft = {
  modeSel: "material" | "rate";
  matSel: string; newName: string; newUnit: string; price: string; rate: string;
};

const normUnit = (u: string | null | undefined) => (u ?? "").replace(/\s/g, "").toLowerCase();
// Length/area measures default to the rate path (a per-m² material price rarely exists).
const RATE_UNITS = new Set(["m", "m2", "m²", "sqm", "lm"]);

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

const shortDesc = (s: string) => (s.length > 32 ? `${s.slice(0, 32).trim()}…` : s);

// Up to 2 similar PRICED lines from the same bill: same element (+2), same unit
// (+2), shared description words >3 chars (+1 each); keep score ≥ 3. Turns
// "guess a number" into "the bill priced the security door at ₦1.25m — anchor
// on that". Reference only: clicking a chip just fills the input (Rule 3).
function similarPriced(pricedLines: PricedLine[], it: Item): PricedLine[] {
  const words = new Set(it.description.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
  return pricedLines
    .map((p) => {
      let score = 0;
      if (p.element_name && it.element_name && p.element_name === it.element_name) score += 2;
      if (p.unit && it.unit && normUnit(p.unit) === normUnit(it.unit)) score += 2;
      for (const w of new Set(p.description.toLowerCase().split(/[^a-z0-9]+/)))
        if (w.length > 3 && words.has(w)) score += 1;
      return { p, score };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.p);
}

// "K items have no price — give each one." Two ways per line: price a material
// (supply/fittings — guarded so a bag-priced material can never be applied to a
// m²-measured line again) or take an agreed rate per unit (any kind → labour-only
// 'Rate: …' mix, kind set to labour, stray material cleared). All server
// functions, all human-entered (Rules 1 & 3). Rows that already carry a material
// but still price to nothing land here too, with a detach button.
export function PriceMissingPanel({ orgId, materials, items, pricedLines = [] }: {
  orgId: string; materials: Material[]; items: Item[]; pricedLines?: PricedLine[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => {
    const d: Record<string, Draft> = {};
    for (const it of items) {
      const match = it.material_id ? materials.find((m) => m.id === it.material_id) ?? null : bestMatch(materials, it.description);
      d[it.id] = {
        modeSel: it.kind === "labour" || it.kind === "plant" || RATE_UNITS.has(normUnit(it.unit)) ? "rate" : "material",
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

  const canPriceMaterial = (k: string) => k === "fitting" || k === "material_supply";
  const selectedMat = (d: Draft) => (d.matSel === "__new__" ? null : materials.find((m) => m.id === d.matSel) ?? null);
  // The guard that stops the silent nothing: an existing material priced per bag
  // can't be applied to a line measured in m².
  const unitMismatch = (it: Item, d: Draft): Material | null => {
    if (d.modeSel !== "material") return null;
    const m = selectedMat(d);
    if (!m || !it.unit) return null;
    return normUnit(m.unit) === normUnit(it.unit) ? null : m;
  };

  const filled = (it: Item) => {
    const d = drafts[it.id];
    if (!d || applied[it.id]) return false;
    if (d.modeSel === "rate") return d.rate !== "" && Number(d.rate) > 0;
    if (!canPriceMaterial(it.kind)) return false;
    if (unitMismatch(it, d)) return false;
    return d.price !== "" && Number(d.price) > 0 && (d.matSel !== "__new__" || (d.newName.trim() !== "" && d.newUnit.trim() !== ""));
  };

  // Returns the success line for the row ("₦X per unit").
  async function applyOne(it: Item): Promise<string> {
    const d = drafts[it.id];
    if (d.modeSel === "rate") {
      const { data: aid, error: aErr } = await supabase.rpc("fn_upsert_assembly", {
        p_org: orgId, p_name: `Rate: ${it.description.slice(0, 40).trim()}`,
        p_unit: it.unit ?? "unit", p_kind: "custom", p_ratio: null, p_dry_factor: 1,
        p_labour_rate: Number(d.rate), p_plant_rate: null, p_alt_group: null, p_components: [],
      });
      if (aErr) throw new Error(aErr.message);
      const { error: uErr } = await supabase.rpc("fn_update_work_item", {
        p_work_item: it.id, p_kind: "labour", p_assembly: aid as string, p_material: null,
        p_clear_material: true, p_clear_assembly: false, p_in_scope: null,
      });
      if (uErr) throw new Error(uErr.message);
      return `₦${Number(d.rate).toLocaleString("en-NG")} per ${it.unit ?? "unit"}`;
    }
    let mat = d.matSel;
    let unit = selectedMat(d)?.unit ?? (d.newUnit.trim() || it.unit || "unit");
    if (mat === "__new__") {
      unit = d.newUnit.trim() || it.unit || "unit";
      const { data, error } = await supabase.rpc("fn_upsert_material", {
        p_org: orgId, p_name: d.newName.trim(), p_unit: unit,
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
      p_clear_material: false, p_clear_assembly: false, p_in_scope: null,
    });
    if (uErr) throw new Error(uErr.message);
    return `₦${Number(d.price).toLocaleString("en-NG")} per ${unit}`;
  }

  async function apply(it: Item) {
    setBusy(true); setApplyingId(it.id); setErr(null);
    try {
      const line = await applyOne(it);
      setApplied((s) => ({ ...s, [it.id]: line }));
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setApplyingId(null);
    }
  }
  async function applyAllFilled() {
    setBusy(true); setErr(null);
    try {
      for (const it of items) {
        if (!filled(it)) continue;
        setApplyingId(it.id);
        const line = await applyOne(it);
        setApplied((s) => ({ ...s, [it.id]: line }));
      }
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      router.refresh(); // whatever already applied should land
    } finally {
      setBusy(false); setApplyingId(null);
    }
  }
  async function detach(it: Item) {
    setBusy(true); setApplyingId(it.id); setErr(null);
    const { error } = await supabase.rpc("fn_update_work_item", {
      p_work_item: it.id, p_kind: null, p_assembly: null, p_material: null,
      p_clear_material: true, p_clear_assembly: false, p_in_scope: null,
    });
    setBusy(false); setApplyingId(null);
    if (error) setErr(error.message);
    else router.refresh();
  }

  // Reference chips, computed once per mount (props are server-render stable).
  const refsOf = useMemo(() => {
    const m = new Map<string, PricedLine[]>();
    for (const it of items) m.set(it.id, similarPriced(pricedLines, it));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (items.length === 0) return null;
  const filledCount = items.filter(filled).length;
  const spinner = <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />;

  return (
    <div className="mt-2 space-y-3">
      <p className="text-sm text-[#c7cedb]">
        {items.length} item{items.length === 1 ? "" : "s"} have no price — give each one.
      </p>
      <p className="text-xs text-[#8b95a7]">
        These lines had no rate in the bill (blank / &quot;NOT APPLICABLE&quot;) — the QS&apos;s own priced lines are used automatically everywhere else.
      </p>
      {err && <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}

      <ul className="space-y-2">
        {items.map((it) => {
          const d = drafts[it.id];
          if (!d) return null;
          if (applied[it.id]) {
            // Instant feedback — the row is done (the refresh will clear it from the list).
            return (
              <li key={it.id} className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2.5 text-sm text-emerald-300">
                <IconCheck className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{it.description}</span>
                <span className="shrink-0 font-mono">priced — {applied[it.id]}</span>
              </li>
            );
          }
          const attached = it.material_id ? materials.find((m) => m.id === it.material_id) ?? null : null;
          const mismatch = unitMismatch(it, d);
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
              <p className="mt-0.5 text-[11px] text-[#5b6473]">The QS left this line unpriced in the bill.</p>

              {/* A material is attached but still prices to nothing — say so, offer detach. */}
              {attached && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent-500/25 bg-accent-500/[0.06] px-3 py-2 text-xs text-accent-300">
                  <IconAlert className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    &quot;{attached.name}&quot; is attached but the line still has no cost
                    {it.unit && normUnit(attached.unit) !== normUnit(it.unit) ? ` (it's priced per ${attached.unit}, the line is measured in ${it.unit})` : ""} — fix it below or detach.
                  </span>
                  <button className="btn btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => detach(it)}>
                    {applyingId === it.id ? spinner : "detach material"}
                  </button>
                </div>
              )}

              {/* Two ways to a price — material or agreed rate (works for any kind). */}
              <div className="mt-2 grid max-w-xs grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
                {(["material", "rate"] as const).map((mo) => (
                  <button key={mo} type="button" disabled={busy}
                    onClick={() => patch(it.id, { modeSel: mo })}
                    className={`rounded-lg px-2 py-1 text-xs font-medium transition ${
                      d.modeSel === mo ? "bg-accent-sheen text-ink-950 shadow" : "text-[#8b95a7] hover:text-white"}`}>
                    {mo === "material" ? "Price a material" : `Agreed rate per ${it.unit ?? "unit"}`}
                  </button>
                ))}
              </div>

              {/* Anchors from the bill itself — click to fill the active input. */}
              {(() => {
                const refs = refsOf.get(it.id) ?? [];
                return refs.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-[#5b6473]">similar priced lines in this bill:</span>
                    {refs.map((p, i) => (
                      <button key={i} type="button" disabled={busy}
                        title={p.description}
                        onClick={() => patch(it.id, d.modeSel === "rate" ? { rate: String(p.boq_rate) } : { price: String(p.boq_rate) })}
                        className="badge badge-blue transition hover:text-white">
                        {shortDesc(p.description)} — ₦{p.boq_rate.toLocaleString("en-NG")}/{p.unit ?? "unit"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-[#5b6473]">no similar priced line in this bill — enter your quote or market rate.</p>
                );
              })()}

              {d.modeSel === "material" && (
                canPriceMaterial(it.kind) ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-[14rem] flex-1">
                      <label className="label">Material</label>
                      <select className={`select py-1.5 ${mismatch ? "border-accent-500/50" : ""}`} value={d.matSel} disabled={busy}
                        onChange={(e) => patch(it.id, { matSel: e.target.value })}>
                        <option value="__new__">+ create new: {d.newName || "…"} (per {it.unit ?? (d.newUnit || "unit")})</option>
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
                      {applyingId === it.id ? spinner : "Apply"}
                    </button>
                    {mismatch && (
                      <p className="basis-full text-xs text-accent-300">
                        <IconAlert className="mr-1 inline h-3.5 w-3.5" />
                        this material is priced per {mismatch.unit} but the line is measured in {it.unit} — pick a matching one, create new (per {it.unit}), or use the rate option.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-[#8b95a7]">
                    {it.kind === "composite"
                      ? "needs a Mix — see Mixes below (or take an agreed rate)"
                      : "this line can't be priced by material — use the agreed-rate option"}
                  </p>
                )
              )}

              {d.modeSel === "rate" && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <div className="w-44">
                    <label className="label">Agreed rate (₦ per {it.unit ?? "unit"})</label>
                    <input type="number" min="0" className="input py-1.5" placeholder="0" value={d.rate} disabled={busy}
                      onChange={(e) => patch(it.id, { rate: e.target.value })} />
                  </div>
                  <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy || !filled(it)} onClick={() => apply(it)}>
                    {applyingId === it.id ? spinner : "Apply"}
                  </button>
                  <span className="text-xs text-[#5b6473]">all-in ₦/{it.unit ?? "unit"} — stored as a &quot;Rate:&quot; mix</span>
                </div>
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
