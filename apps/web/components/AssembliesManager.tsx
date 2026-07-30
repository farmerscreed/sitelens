"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconCheck, IconAlert } from "@/components/icons";

type Material = { id: string; name: string; unit: string };
type ComponentRow = {
  assembly_id?: string; material_id: string; qty_per_unit: number | string;
  unit: string; waste_factor: number | string; component_kind: string; reuse_count: number | string | null;
};
type Assembly = {
  id: string; name: string; unit: string; kind: string; ratio: string | null;
  dry_factor: number | string; labour_rate: number | string | null; plant_rate: number | string | null;
  alternative_group: string | null; components: ComponentRow[];
};
type Conversion = { id: string; material_id: string; from_unit: string; to_unit: string; factor: number | string };
type CompDraft = {
  material_id: string; qty_per_unit: string; unit: string; waste_factor: string;
  component_kind: "consumable" | "reusable"; reuse_count: string;
};

const KINDS = ["concrete", "blockwork", "mortar", "render", "screed", "custom"] as const;
const BAG_LITRES = 34.5; // one 50 kg cement bag ≈ 34.5 L
const GRADES = [
  { grade: "Grade 15", ratio: "1:3:6" },
  { grade: "Grade 20", ratio: "1:2:4" },
  { grade: "Grade 25", ratio: "1:1.5:3" },
];
const ngn = (n: number) => "₦" + n.toLocaleString("en-NG");
const emptyComp = (): CompDraft =>
  ({ material_id: "", qty_per_unit: "", unit: "", waste_factor: "1.05", component_kind: "consumable", reuse_count: "" });

// Assembly library editor. All writes go through fn_upsert_assembly /
// fn_set_material_conversion (SECURITY DEFINER, manager-gated — Rule 1). The
// ratio calculator only DERIVES editable rows: the human reviews and confirms
// every figure before anything is saved (Rule 3).
export function AssembliesManager({ orgId, materials, assemblies, conversions }: {
  orgId: string; materials: Material[]; assemblies: Assembly[]; conversions: Conversion[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const matOf = (id: string) => materials.find((m) => m.id === id);

  // ── Assembly form ──────────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("m3");
  const [kind, setKind] = useState<string>("concrete");
  const [ratio, setRatio] = useState("");
  const [dryFactor, setDryFactor] = useState("1.54");
  const [labourRate, setLabourRate] = useState("");
  const [plantRate, setPlantRate] = useState("");
  const [altGroup, setAltGroup] = useState("");
  const [comps, setComps] = useState<CompDraft[]>([]);

  // ── Ratio calculator (concrete) ────────────────────────────────────────────
  const [cementId, setCementId] = useState("");
  const [sandId, setSandId] = useState("");
  const [graniteId, setGraniteId] = useState("");

  const parts = ratio.split(":").map((p) => Number(p.trim()));
  const ratioValid = parts.length === 3 && parts.every((p) => Number.isFinite(p) && p > 0);
  const normRatio = ratioValid ? parts.join(":") : null;
  const matchedGrade = GRADES.find((g) => g.ratio === normRatio);
  const nonStandard = ratioValid && !matchedGrade;

  function resetForm() {
    setEditingId(null); setName(""); setUnit("m3"); setKind("concrete"); setRatio("");
    setDryFactor("1.54"); setLabourRate(""); setPlantRate(""); setAltGroup(""); setComps([]);
  }
  function loadAssembly(a: Assembly) {
    setEditingId(a.id); setName(a.name); setUnit(a.unit); setKind(a.kind);
    setRatio(a.ratio ?? ""); setDryFactor(String(a.dry_factor ?? "1.54"));
    setLabourRate(a.labour_rate == null ? "" : String(a.labour_rate));
    setPlantRate(a.plant_rate == null ? "" : String(a.plant_rate));
    setAltGroup(a.alternative_group ?? "");
    setComps(a.components.map((c) => ({
      material_id: c.material_id, qty_per_unit: String(c.qty_per_unit), unit: c.unit,
      waste_factor: String(c.waste_factor), component_kind: c.component_kind as "consumable" | "reusable",
      reuse_count: c.reuse_count == null ? "" : String(c.reuse_count),
    })));
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function patchComp(i: number, p: Partial<CompDraft>) {
    setComps((s) => s.map((c, j) => (j === i ? { ...c, ...p } : c)));
  }

  // Derive per-m³ quantities from the ratio (dry-volume method). Rows land in the
  // components editor for the human to check and adjust — nothing is saved yet.
  function derive() {
    if (!ratioValid || !cementId || !sandId || !graniteId) return;
    const [c, s, g] = parts;
    const total = c + s + g;
    const df = Number(dryFactor) || 1.54;
    const cementBags = (df * (c / total) * 1000) / BAG_LITRES;
    const sandM3 = (df * s) / total;
    const graniteM3 = (df * g) / total;
    const row = (material_id: string, qty: number, u: string): CompDraft =>
      ({ material_id, qty_per_unit: qty.toFixed(3), unit: u, waste_factor: "1.05", component_kind: "consumable", reuse_count: "" });
    setComps([row(cementId, cementBags, "bag"), row(sandId, sandM3, "m3"), row(graniteId, graniteM3, "m3")]);
    setMsg({ ok: true, t: "Quantities derived — check and adjust the rows below, then save." });
  }

  async function save() {
    const components = comps
      .filter((c) => c.material_id && c.qty_per_unit !== "" && Number(c.qty_per_unit) > 0)
      .map((c) => ({
        material_id: c.material_id,
        qty_per_unit: Number(c.qty_per_unit),
        unit: c.unit,
        waste_factor: c.waste_factor === "" ? 1.05 : Number(c.waste_factor),
        component_kind: c.component_kind,
        reuse_count: c.component_kind === "reusable" && c.reuse_count !== "" ? Number(c.reuse_count) : null,
      }));
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_upsert_assembly", {
      p_org: orgId, p_name: name.trim(), p_unit: unit.trim(), p_kind: kind,
      p_ratio: ratio.trim() || null, p_dry_factor: Number(dryFactor) || 1.54,
      p_labour_rate: labourRate === "" ? null : Number(labourRate),
      p_plant_rate: plantRate === "" ? null : Number(plantRate),
      p_alt_group: altGroup.trim() || null, p_components: components,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: `Assembly "${name}" saved.` }); resetForm(); router.refresh(); }
  }

  // ── Unit conversions ───────────────────────────────────────────────────────
  const [cvMat, setCvMat] = useState("");
  const [cvFrom, setCvFrom] = useState("");
  const [cvTo, setCvTo] = useState("");
  const [cvFactor, setCvFactor] = useState("");

  function suggestConversion(nameLike: RegExp, from: string, to: string, factor: string) {
    const m = materials.find((x) => nameLike.test(x.name));
    if (m) setCvMat(m.id);
    setCvFrom(from); setCvTo(to); setCvFactor(factor);
  }
  async function saveConversion() {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_set_material_conversion", {
      p_org: orgId, p_material: cvMat, p_from: cvFrom.trim(), p_to: cvTo.trim(), p_factor: Number(cvFactor),
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: "Conversion saved." }); setCvFrom(""); setCvTo(""); setCvFactor(""); router.refresh(); }
  }

  return (
    <div className="space-y-6">
      {msg && (
        <div className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
          msg.ok ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                 : "border-red-500/20 bg-red-500/[0.06] text-red-300"}`}>
          {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
        </div>
      )}

      {/* ── Create / edit ─────────────────────────────────────────────────── */}
      <section className="card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-white">{editingId ? "Edit assembly" : "New assembly"}</h2>
          {editingId && <button className="btn btn-ghost px-3 py-1 text-xs" onClick={resetForm}>Start fresh</button>}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <label className="label">Name</label>
            <input className="input" placeholder="e.g. Concrete 1:2:4 (G20)" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Output unit</label>
            <input className="input" placeholder="m3 / m2 / nr" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </div>
          <div>
            <label className="label">Kind</label>
            <select className="select" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Labour rate (₦/{unit || "unit"})</label>
            <input type="number" min="0" className="input" placeholder="—" value={labourRate} onChange={(e) => setLabourRate(e.target.value)} />
          </div>
          <div>
            <label className="label">Plant rate (₦/{unit || "unit"})</label>
            <input type="number" min="0" className="input" placeholder="—" value={plantRate} onChange={(e) => setPlantRate(e.target.value)} />
          </div>
          <div className="lg:col-span-2">
            <label className="label">Alternative group <span className="text-[#5b6473]">(same output, different route)</span></label>
            <input className="input" placeholder="e.g. blockwork-225" value={altGroup} onChange={(e) => setAltGroup(e.target.value)} />
          </div>
        </div>

        {/* Ratio calculator */}
        <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
          <h3 className="text-sm font-semibold text-white">Ratio calculator <span className="font-normal text-[#8b95a7]">— concrete, per m³ (dry-volume method)</span></h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="label">Mix ratio (c:s:g)</label>
              <input className="input" placeholder="1:2:4" value={ratio} onChange={(e) => setRatio(e.target.value)} />
            </div>
            <div>
              <label className="label">Dry factor</label>
              <input type="number" step="0.01" className="input" value={dryFactor} onChange={(e) => setDryFactor(e.target.value)} />
            </div>
            <div>
              <label className="label">Cement material</label>
              <select className="select" value={cementId} onChange={(e) => setCementId(e.target.value)}>
                <option value="">— pick —</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Sand material</label>
              <select className="select" value={sandId} onChange={(e) => setSandId(e.target.value)}>
                <option value="">— pick —</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Granite material</label>
              <select className="select" value={graniteId} onChange={(e) => setGraniteId(e.target.value)}>
                <option value="">— pick —</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-ghost" disabled={busy || !ratioValid || !cementId || !sandId || !graniteId} onClick={derive}>
              Derive quantities
            </button>
            {matchedGrade && <span className="badge badge-green">{matchedGrade.grade} — standard mix</span>}
            {nonStandard && (
              <span className="flex items-center gap-1.5 text-sm text-accent-300">
                <IconAlert className="h-4 w-4" />{normRatio} matches no standard grade — double-check before saving.
              </span>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>Grade</th>{GRADES.map((g) => <th key={g.grade}>{g.grade}</th>)}</tr></thead>
              <tbody>
                <tr>
                  <td className="text-[#8b95a7]">Ratio</td>
                  {GRADES.map((g) => (
                    <td key={g.grade} className={`font-mono ${normRatio === g.ratio ? "text-accent-300" : "text-white"}`}>{g.ratio}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#8b95a7]">
            Cement bags/m³ = dry × (c/total) × 1000 ÷ {BAG_LITRES} (50 kg bag ≈ {BAG_LITRES} L); sand &amp; granite m³/m³ = dry × part/total.
            Derived rows are proposals — you confirm them below.
          </p>
        </div>

        {/* Components editor */}
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-white">Components <span className="font-normal text-[#8b95a7]">— per 1 {unit || "unit"} of output</span></h3>
          <div className="mt-2 overflow-x-auto">
            <table className="table-base min-w-[760px]">
              <thead>
                <tr><th>Material</th><th>Qty / {unit || "unit"}</th><th>Unit</th><th>Waste ×</th><th>Type</th><th>Reuses</th><th /></tr>
              </thead>
              <tbody>
                {comps.map((c, i) => (
                  <tr key={i}>
                    <td>
                      <select className={`select py-1.5 ${c.material_id ? "" : "border-accent-500/50"}`} value={c.material_id}
                        onChange={(e) => patchComp(i, { material_id: e.target.value, unit: c.unit || (matOf(e.target.value)?.unit ?? "") })}>
                        <option value="">— pick —</option>
                        {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </td>
                    <td><input type="number" step="0.001" className="input w-24 py-1.5" value={c.qty_per_unit} onChange={(e) => patchComp(i, { qty_per_unit: e.target.value })} /></td>
                    <td><input className="input w-20 py-1.5" value={c.unit} onChange={(e) => patchComp(i, { unit: e.target.value })} /></td>
                    <td><input type="number" step="0.01" className="input w-20 py-1.5" value={c.waste_factor} onChange={(e) => patchComp(i, { waste_factor: e.target.value })} /></td>
                    <td>
                      <select className="select py-1.5" value={c.component_kind}
                        onChange={(e) => patchComp(i, { component_kind: e.target.value as "consumable" | "reusable" })}>
                        <option value="consumable">consumable</option>
                        <option value="reusable">reusable</option>
                      </select>
                    </td>
                    <td>
                      <input type="number" min="1" className="input w-16 py-1.5" placeholder="—" disabled={c.component_kind !== "reusable"}
                        value={c.reuse_count} onChange={(e) => patchComp(i, { reuse_count: e.target.value })} />
                    </td>
                    <td>
                      <button className="text-xs text-[#8b95a7] transition hover:text-red-300"
                        onClick={() => setComps((s) => s.filter((_, j) => j !== i))}>Remove</button>
                    </td>
                  </tr>
                ))}
                {comps.length === 0 && (
                  <tr><td colSpan={7} className="py-5 text-center text-[#8b95a7]">No components yet — derive from a ratio or add one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-ghost" onClick={() => setComps((s) => [...s, emptyComp()])}>
              <IconPlus className="h-4 w-4" />Add component
            </button>
            <button className="btn btn-primary" disabled={busy || !name.trim() || !unit.trim()} onClick={save}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Save assembly"}
            </button>
            <span className="text-xs text-[#8b95a7]">Reusable components (e.g. formwork) are costed ÷ reuses; consumables × waste.</span>
          </div>
        </div>
      </section>

      {/* ── Library ───────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-white">Library <span className="font-normal text-[#8b95a7]">({assemblies.length})</span></h2>
        {assemblies.length === 0 && <p className="card text-sm text-[#8b95a7]">No assemblies yet — create the first one above.</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          {assemblies.map((a) => (
            <div key={a.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{a.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-[#8b95a7]">
                    <span className="badge badge-muted">{a.kind}</span>
                    per {a.unit}
                    {a.ratio && <span className="badge badge-blue">mix {a.ratio}</span>}
                    {a.alternative_group && <span className="badge badge-muted">alt: {a.alternative_group}</span>}
                  </p>
                </div>
                <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => loadAssembly(a)}>Edit</button>
              </div>
              <ul className="mt-3 space-y-1">
                {a.components.map((c, i) => {
                  const m = matOf(c.material_id);
                  return (
                    <li key={i} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-1.5 text-sm">
                      <span className="min-w-0 truncate text-[#c7cedb]">{m?.name ?? c.material_id}</span>
                      <span className="shrink-0 font-mono text-xs text-[#8b95a7]">
                        {Number(c.qty_per_unit).toLocaleString("en-NG", { maximumFractionDigits: 3 })} {c.unit}
                        {c.component_kind === "reusable"
                          ? ` · ÷${Number(c.reuse_count ?? 1)}`
                          : ` · ×${Number(c.waste_factor)}`}
                      </span>
                    </li>
                  );
                })}
                {a.components.length === 0 && <li className="text-xs text-[#8b95a7]">No components (labour/plant only{a.labour_rate != null ? ` — ${ngn(Number(a.labour_rate))}/${a.unit}` : ""}).</li>}
              </ul>
              {(a.labour_rate != null || a.plant_rate != null) && a.components.length > 0 && (
                <p className="mt-2 text-xs text-[#8b95a7]">
                  {a.labour_rate != null && <>labour {ngn(Number(a.labour_rate))}/{a.unit}</>}
                  {a.labour_rate != null && a.plant_rate != null && " · "}
                  {a.plant_rate != null && <>plant {ngn(Number(a.plant_rate))}/{a.unit}</>}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Unit conversions ──────────────────────────────────────────────── */}
      <section className="card p-0 overflow-hidden">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold text-white">Unit conversions</h2>
          <p className="mt-0.5 text-xs text-[#8b95a7]">Bridge a bill&apos;s unit into the stock unit — qty[to] = qty[from] × factor. Needed before take-off can convert (never guessed).</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead><tr><th>Material</th><th>From</th><th>To</th><th className="text-right">Factor</th></tr></thead>
            <tbody>
              {conversions.map((c) => (
                <tr key={c.id}>
                  <td className="text-white">{matOf(c.material_id)?.name ?? c.material_id}</td>
                  <td className="text-[#8b95a7]">{c.from_unit}</td>
                  <td className="text-[#8b95a7]">{c.to_unit}</td>
                  <td className="text-right font-mono">{Number(c.factor).toLocaleString("en-NG", { maximumFractionDigits: 4 })}</td>
                </tr>
              ))}
              {conversions.length === 0 && <tr><td colSpan={4} className="py-5 text-center text-[#8b95a7]">No conversions yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-[#8b95a7]">Standards:</span>
            <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => suggestConversion(/sand/i, "m3", "ton", "1.6")}>sand m³→ton ×1.6</button>
            <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => suggestConversion(/granite|gravel|chipping/i, "m3", "ton", "1.5")}>granite m³→ton ×1.5</button>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="label">Material</label>
              <select className="select" value={cvMat} onChange={(e) => setCvMat(e.target.value)}>
                <option value="">— pick —</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name} (stock: {m.unit})</option>)}
              </select>
            </div>
            <div className="sm:w-24"><label className="label">From</label>
              <input className="input" placeholder="m3" value={cvFrom} onChange={(e) => setCvFrom(e.target.value)} /></div>
            <div className="sm:w-24"><label className="label">To</label>
              <input className="input" placeholder="ton" value={cvTo} onChange={(e) => setCvTo(e.target.value)} /></div>
            <div className="sm:w-28"><label className="label">Factor</label>
              <input type="number" step="0.0001" className="input" placeholder="1.6" value={cvFactor} onChange={(e) => setCvFactor(e.target.value)} /></div>
            <button className="btn btn-primary shrink-0"
              disabled={busy || !cvMat || !cvFrom.trim() || !cvTo.trim() || cvFactor === "" || Number(cvFactor) <= 0}
              onClick={saveConversion}>{busy ? "…" : "Save"}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
