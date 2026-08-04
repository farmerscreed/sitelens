"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconAlert } from "@/components/icons";

export type ProposalCandidate = {
  id: string;                 // staged row id (review mode) or work item id (recipe mode)
  description: string;
  mix_ratio: string | null;
  boq_rate: number | null;
  boq_rate_labour?: number | null;  // split-rate bills separate labour explicitly
  unit: string | null;
  context?: string | null;    // section/element text — scanned for grade when the row itself is silent
};
export type ProposalAttachment = { assemblyId: string; assemblyName: string; assemblyUnit: string; itemIds: string[] };
type Material = { id: string; name: string; unit: string };
type ExistingAssembly = { id: string; name: string; unit: string; ratio: string | null };

const BAG_LITRES = 34.5;
const MORTAR_DRY = 1.3;
const GRADE_RATIO: Record<string, string> = { "15": "1:3:6", "20": "1:2:4", "25": "1:1.5:3" };
const RATIO_GRADE: Record<string, string> = { "1:3:6": "15", "1:2:4": "20", "1:1.5:3": "25" };
// Standard mixes for mangled-ratio repair (concrete 3-part + mortar 2-part).
const STANDARD_MIXES: number[][] = [[1, 1.5, 3], [1, 2, 4], [1, 3, 6], [1, 3], [1, 4], [1, 6]];
const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

function parseRatioText(s: string | null | undefined): { parts: number[]; text: string } | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null;
  const parts = m[3] != null ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[1]), Number(m[2])];
  return parts.every((p) => Number.isFinite(p) && p > 0) ? { parts, text: m[0].replace(/\s/g, "") } : null;
}
const parseRatio = (s: string | null | undefined) => parseRatioText(s)?.parts ?? null;

// Mangled-ratio repair: bills write "1:3.6:20" where the 20 is the AGGREGATE SIZE
// in mm, not a mix part — strip a 3rd term > 8, then snap to the nearest standard
// mix by summed term distance. Caller shows a note whenever the repair changed it.
function repairRatio(parts: number[]): { parts: number[]; repaired: boolean } {
  let p = [...parts];
  if (p.length === 3 && p[2] > 8) p = [p[0], p[1]];
  let best = p; let bestD = Infinity;
  for (const s of STANDARD_MIXES) {
    if (s.length !== p.length) continue;
    const d = s.reduce((a, v, i) => a + Math.abs(v - p[i]), 0);
    if (d < bestD) { bestD = d; best = s; }
  }
  return { parts: best, repaired: best.join(":") !== parts.join(":") };
}

type Classified = {
  assemblyKind: string;
  ratio: number[] | null;
  thickness: number | null;    // wall/bed thickness in mm (blockwork/render/screed)
  repairNote: string | null;
  contextNote: string | null;
};

// Classify one candidate: explicit mix_ratio → ratio/grade written in the description
// → (concrete only) grade/ratio from the section context → trade defaults → custom.
function classify(c: ProposalCandidate): Classified | null {
  const d = c.description;
  const explicit = parseRatioText(c.mix_ratio) ?? parseRatioText(d);
  const descGrade = d.match(/grade\s*(15|20|25)/i)?.[1] ?? null;

  const trade =
    /blockwork/i.test(d) ? "blockwork" :
    /render|plaster/i.test(d) ? "render" :
    /screed/i.test(d) ? "screed" :
    /mortar/i.test(d) ? "mortar" : null;
  let kind: string | null = trade;
  if (!kind && explicit && explicit.parts.length === 3) kind = "concrete";
  if (!kind && (descGrade || /concrete/i.test(d))) kind = "concrete";
  if (!kind) return null;

  let thickness: number | null = null;
  if (kind === "blockwork") thickness = /150\s*mm/i.test(d) ? 150 : 225;
  else if (kind === "render" || kind === "screed") {
    const t = Number(d.match(/(\d+(?:\.\d+)?)\s*mm/i)?.[1]);
    const [def, lo, hi] = kind === "render" ? [15, 5, 50] : [40, 20, 100];
    thickness = Number.isFinite(t) && t >= lo && t <= hi ? t : def;
  }

  let ratio: number[] | null = null;
  let repairNote: string | null = null;
  let contextNote: string | null = null;

  if (explicit) {
    const rep = repairRatio(explicit.parts);
    ratio = rep.parts;
    if (rep.repaired) {
      const snapStr = rep.parts.join(":");
      const tag = RATIO_GRADE[snapStr] ? ` (grade ${RATIO_GRADE[snapStr]} standard)` : " (standard mix)";
      repairNote = `bill says "${explicit.text}" — interpreted as ${snapStr}${tag}; edit if wrong`;
    }
  } else if (descGrade) {
    ratio = parseRatio(GRADE_RATIO[descGrade]);
  } else if (kind === "concrete" && c.context) {
    // Grade-from-context: the section heading often carries what the line omits.
    const ctxRatio = parseRatioText(c.context);
    const ctxGrade = c.context.match(/grade\s*(15|20|25)/i)?.[1];
    if (ctxRatio) {
      const rep = repairRatio(ctxRatio.parts);
      ratio = rep.parts;
      contextNote = `mix ${rep.parts.join(":")} taken from section context ("${ctxRatio.text}")`;
    } else if (ctxGrade) {
      ratio = parseRatio(GRADE_RATIO[ctxGrade]);
      contextNote = `grade ${ctxGrade} from section context`;
    }
  }
  if (!ratio && kind !== "concrete")
    ratio = parseRatio(kind === "render" ? "1:4" : kind === "screed" ? "1:3" : "1:6");

  return { assemblyKind: kind, ratio, thickness, repairNote, contextNote };
}

function proposalName(assemblyKind: string, ratioStr: string | null, thickness: number | null): string {
  if (assemblyKind === "concrete") {
    const grade = ratioStr ? RATIO_GRADE[ratioStr] : undefined;
    if (grade) return `Concrete grade ${grade} (${ratioStr})`;
    return ratioStr ? `Concrete mix ${ratioStr}` : "Concrete (custom mix)";
  }
  if (assemblyKind === "blockwork") return `${thickness ?? 225}mm Blockwork (${ratioStr ?? "1:6"} mortar)`;
  const label = assemblyKind[0].toUpperCase() + assemblyKind.slice(1);
  if ((assemblyKind === "render" || assemblyKind === "screed") && thickness != null)
    return `${label} ${thickness}mm (${ratioStr ?? "custom"})`;
  return ratioStr ? `${label} ${ratioStr}` : `${label} (custom)`;
}

type CompDraft = {
  role: "cement" | "sand" | "granite" | "block";
  materialId: string | null;   // null → will be created on confirm
  name: string; unit: string; qty: string; waste: string;
};

// Auto-pick catalog materials for the mix components by name; a missing one is
// proposed as "will be created" (fn_upsert_material on confirm).
function pickComponent(materials: Material[], role: "cement" | "sand" | "granite"): { materialId: string | null; name: string; unit: string } {
  const rx = role === "cement" ? /cement/i : role === "sand" ? /sand/i : /granite|gravel|chipping/i;
  const m = materials.find((x) => rx.test(x.name));
  if (m) return { materialId: m.id, name: m.name, unit: role === "cement" ? "bag" : "m3" };
  return {
    materialId: null,
    name: role === "cement" ? "Cement" : role === "sand" ? "Sharp sand" : "Granite",
    unit: role === "cement" ? "bag" : "m3",
  };
}
function pickBlock(materials: Material[], thickness: number): { materialId: string | null; name: string; unit: string } {
  const blocks = materials.filter((m) => /block/i.test(m.name));
  const m = blocks.find((b) => b.name.includes(String(thickness))) ?? blocks[0];
  if (m) return { materialId: m.id, name: m.name, unit: "nr" };
  return { materialId: null, name: `Sandcrete block ${thickness}mm`, unit: "nr" };
}

const unitIs = (unit: string, kind: "m2" | "m3") => {
  const u = unit.replace(/\s/g, "").toLowerCase();
  return kind === "m3" ? u === "m3" || u === "m³" : u === "m2" || u === "m²" || u === "sqm";
};

// Cement + sand from a mortar volume (m³ of wet mortar per output unit), split by
// the 2-part ratio with the mortar dry factor — the same dry-volume method as the
// /assemblies calculator, applied to a bed/joint volume.
function mortarComps(materials: Material[], vol: number, parts: number[], waste: string): CompDraft[] {
  const total = parts[0] + parts[1];
  return [
    { role: "cement", ...pickComponent(materials, "cement"), qty: ((vol * MORTAR_DRY * (parts[0] / total) * 1000) / BAG_LITRES).toFixed(3), waste },
    { role: "sand", ...pickComponent(materials, "sand"), qty: (vol * MORTAR_DRY * (parts[1] / total)).toFixed(3), waste },
  ];
}

// Derive editable component rows + the working shown to the user. Per m³ for
// concrete/mortar-family; per m² for blockwork (blocks + joint mortar) and
// render/screed (bed thickness × ratio). Genuinely unrecognized work stays
// underivable and keeps the "no breakdown" fallback.
function deriveComps(materials: Material[], assemblyKind: string, ratio: number[] | null, unit: string, thickness: number | null):
  { comps: CompDraft[]; working: string | null; dryFactor: number } {
  if (assemblyKind === "concrete" && ratio && unitIs(unit, "m3")) {
    const total = ratio.reduce((a, b) => a + b, 0);
    const comps: CompDraft[] = [
      { role: "cement", ...pickComponent(materials, "cement"), qty: ((1.54 * (ratio[0] / total) * 1000) / BAG_LITRES).toFixed(3), waste: "1.03" },
      { role: "sand", ...pickComponent(materials, "sand"), qty: ((1.54 * ratio[1]) / total).toFixed(3), waste: "1.03" },
    ];
    if (ratio.length === 3)
      comps.push({ role: "granite", ...pickComponent(materials, "granite"), qty: ((1.54 * ratio[2]) / total).toFixed(3), waste: "1.03" });
    return { comps, working: `dry-volume ${ratio.join(":")} per m³ (factor 1.54)`, dryFactor: 1.54 };
  }

  if (assemblyKind === "blockwork" && unitIs(unit, "m2")) {
    const t = thickness ?? 225;
    const vol = t === 150 ? 0.02 : 0.025;
    const parts = ratio && ratio.length >= 2 ? ratio.slice(0, 2) : [1, 6];
    const comps: CompDraft[] = [
      { role: "block", ...pickBlock(materials, t), qty: "10", waste: "1.05" },
      ...mortarComps(materials, vol, parts, "1.05"),
    ];
    return { comps, working: `10 blocks + ${vol} m³ mortar (${parts.join(":")}) per m²`, dryFactor: MORTAR_DRY };
  }

  if ((assemblyKind === "render" || assemblyKind === "screed") && unitIs(unit, "m2")) {
    const t = thickness ?? (assemblyKind === "render" ? 15 : 40);
    const vol = t / 1000;
    const parts = ratio && ratio.length >= 2 ? ratio.slice(0, 2) : (assemblyKind === "render" ? [1, 4] : [1, 3]);
    return {
      comps: mortarComps(materials, vol, parts, "1.05"),
      working: `${t} mm bed (${parts.join(":")}) per m² → ${vol.toFixed(3)} m³ mortar`,
      dryFactor: MORTAR_DRY,
    };
  }

  if (ratio && unitIs(unit, "m3")) {
    // mortar/render/screed measured in m³ — straight per-m³ mortar split.
    const parts = ratio.slice(0, 2);
    return { comps: mortarComps(materials, 1, parts, "1.05"), working: `dry-volume ${parts.join(":")} per m³ (factor ${MORTAR_DRY})`, dryFactor: MORTAR_DRY };
  }

  return { comps: [], working: null, dryFactor: assemblyKind === "concrete" ? 1.54 : MORTAR_DRY };
}

type Group = {
  key: string; on: boolean; assemblyKind: string; name: string; unit: string;
  ratioStr: string | null; thickness: number | null; dryFactor: number;
  rows: ProposalCandidate[]; comps: CompDraft[]; working: string | null;
  repairNote: string | null; contextNote: string | null;
  avgRate: number | null; labour: string; labourFromBill: boolean;
  existing: ExistingAssembly | null; useExisting: boolean;
};

// Propose assemblies from composite BOQ lines — THE normal flow for every bill:
// group by mix signature, reuse an existing matching assembly when there is one,
// otherwise derive components (per m³ for concrete, per m² for blockwork/render/
// screed) and surface the IMPLIED labour (BOQ rate − materials) as the negotiating
// baseline. Everything is editable; nothing is written until the human confirms
// (Rule 3).
export function AssemblyProposals({
  orgId, mode, candidates, materials, assemblies, prices, onApplied,
}: {
  orgId: string;
  mode: "review" | "recipe";
  candidates: ProposalCandidate[];
  materials: Material[];
  assemblies: ExistingAssembly[];
  prices: Record<string, number>;   // material_id → current ₦ per stock unit
  onApplied?: (attachments: ProposalAttachment[]) => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const built = useMemo(() => {
    const map = new Map<string, Group>();
    let skipped = 0;
    for (const c of candidates) {
      const sig = classify(c);
      if (!sig) { skipped++; continue; }
      const ratioStr = sig.ratio ? sig.ratio.join(":") : null;
      const key = `${sig.assemblyKind}|${ratioStr ?? "custom"}|${sig.thickness ?? ""}`;
      let g = map.get(key);
      if (!g) {
        const unit = (c.unit ?? (sig.assemblyKind === "concrete" ? "m3" : "m2")).trim();
        const derived = deriveComps(materials, sig.assemblyKind, sig.ratio, unit, sig.thickness);
        const existing = assemblies.find((a) =>
          (a.ratio && ratioStr && a.ratio.trim() === ratioStr) ||
          (ratioStr && RATIO_GRADE[ratioStr] && a.name.toLowerCase().includes(`grade ${RATIO_GRADE[ratioStr]}`)),
        ) ?? null;
        g = {
          key, on: true, assemblyKind: sig.assemblyKind,
          name: proposalName(sig.assemblyKind, ratioStr, sig.thickness),
          unit, ratioStr, thickness: sig.thickness, dryFactor: derived.dryFactor,
          rows: [], comps: derived.comps, working: derived.working,
          repairNote: sig.repairNote, contextNote: sig.contextNote,
          avgRate: null, labour: "", labourFromBill: false, existing, useExisting: !!existing,
        };
        map.set(key, g);
      }
      g.rows.push(c);
    }
    // Labour per group: a split-rate bill states it outright — use that. Otherwise
    // the IMPLIED labour: avg BOQ rate − derived material cost, floored at 0.
    for (const g of map.values()) {
      const rates = g.rows.map((r) => r.boq_rate).filter((r): r is number => r != null);
      g.avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
      const stated = g.rows.map((r) => r.boq_rate_labour).filter((r): r is number => r != null);
      if (stated.length) {
        g.labour = String(Math.round(stated.reduce((a, b) => a + b, 0) / stated.length));
        g.labourFromBill = true;
      } else if (g.avgRate != null) {
        const matCost = g.comps.reduce((a, c) =>
          a + (c.materialId && prices[c.materialId] != null ? Number(c.qty) * Number(c.waste) * prices[c.materialId] : 0), 0);
        g.labour = String(Math.max(0, Math.round(g.avgRate - matCost)));
      }
    }
    return { groups: [...map.values()], skipped };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [groups, setGroups] = useState<Group[]>(built.groups);
  const patchGroup = (i: number, p: Partial<Group>) =>
    setGroups((s) => s.map((g, j) => (j === i ? { ...g, ...p } : g)));
  const patchComp = (gi: number, ci: number, p: Partial<CompDraft>) =>
    setGroups((s) => s.map((g, j) => (j === gi ? { ...g, comps: g.comps.map((c, k) => (k === ci ? { ...c, ...p } : c)) } : g)));

  // Editing the ratio re-derives the component quantities (still editable after).
  function onRatioEdit(gi: number, text: string) {
    setGroups((s) => s.map((g, j) => {
      if (j !== gi) return g;
      const parts = parseRatio(text);
      if (!parts) return { ...g, ratioStr: text };
      const d = deriveComps(materials, g.assemblyKind, parts, g.unit, g.thickness);
      return { ...g, ratioStr: text, comps: d.comps.length ? d.comps : g.comps, working: d.working ?? g.working, dryFactor: d.dryFactor };
    }));
  }

  const matCostOf = (g: Group) => g.comps.reduce((a, c) =>
    a + (c.materialId && prices[c.materialId] != null ? Number(c.qty) * Number(c.waste) * prices[c.materialId] : 0), 0);

  const selected = groups.filter((g) => g.on && (g.useExisting || g.name.trim()));
  const createCount = selected.filter((g) => !(g.useExisting && g.existing)).length;
  const itemCount = selected.reduce((a, g) => a + g.rows.length, 0);

  async function confirmAll() {
    setBusy(true); setMsg(null);
    try {
      const attachments: ProposalAttachment[] = [];
      for (const g of selected) {
        let assemblyId: string; let aName: string; let aUnit: string;
        if (g.useExisting && g.existing) {
          assemblyId = g.existing.id; aName = g.existing.name; aUnit = g.existing.unit;
        } else {
          const compPayload: Record<string, unknown>[] = [];
          for (const c of g.comps) {
            let mid = c.materialId;
            if (!mid) {
              const { data, error } = await supabase.rpc("fn_upsert_material", {
                p_org: orgId, p_name: c.name.trim(), p_unit: c.unit.trim() || "unit",
              });
              if (error) throw new Error(`creating material "${c.name}": ${error.message}`);
              mid = data as string;
            }
            if (c.qty !== "" && Number(c.qty) > 0) {
              compPayload.push({
                material_id: mid, qty_per_unit: Number(c.qty), unit: c.unit,
                waste_factor: Number(c.waste) || 1.05, component_kind: "consumable", reuse_count: null,
              });
            }
          }
          const { data: aid, error: aErr } = await supabase.rpc("fn_upsert_assembly", {
            p_org: orgId, p_name: g.name.trim(), p_unit: g.unit.trim() || "m3",
            p_kind: g.assemblyKind, p_ratio: g.ratioStr, p_dry_factor: g.dryFactor,
            p_labour_rate: g.labour === "" ? null : Number(g.labour), p_plant_rate: null,
            p_alt_group: null, p_components: compPayload,
          });
          if (aErr) throw new Error(`creating assembly "${g.name}": ${aErr.message}`);
          assemblyId = aid as string; aName = g.name.trim(); aUnit = g.unit.trim() || "m3";
        }
        if (mode === "recipe") {
          for (const r of g.rows) {
            const { error } = await supabase.rpc("fn_update_work_item", {
              p_work_item: r.id, p_kind: "composite", p_assembly: assemblyId, p_material: null,
              p_clear_material: false, p_clear_assembly: false, p_in_scope: null,
            });
            if (error) throw new Error(error.message);
          }
        }
        attachments.push({ assemblyId, assemblyName: aName, assemblyUnit: aUnit, itemIds: g.rows.map((r) => r.id) });
      }
      setMsg({ ok: true, t: `Created ${createCount} assembl${createCount === 1 ? "y" : "ies"}, attached to ${itemCount} item(s).` });
      setDone(true);
      if (mode === "review") onApplied?.(attachments);
      else router.refresh();
    } catch (e) {
      setMsg({ ok: false, t: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (groups.length === 0 && built.skipped === 0) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      <div className="px-4 pt-4">
        <p className="text-sm text-[#c7cedb]">
          {groups.length > 0
            ? <>Composite lines detected — one assembly per mix. Existing assemblies are reused; new ones derive their components from the ratio (per m³ for concrete, per m² for blockwork/render/screed), and the <strong className="text-white">implied labour</strong> (BOQ rate − materials) is your negotiating baseline. Edit anything before confirming.</>
            : <>Composite lines were found but none matched a known mix — create their assemblies manually on /assemblies.</>}
          {groups.length > 0 && built.skipped > 0 && (
            <span className="text-[#8b95a7]"> {built.skipped} composite row(s) matched no known mix — handle those on /assemblies.</span>
          )}
        </p>
      </div>

      {msg && (
        <div className={`mx-4 mt-3 flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
          msg.ok ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                 : "border-red-500/20 bg-red-500/[0.06] text-red-300"}`}>
          {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
        </div>
      )}

      <div className="space-y-3 p-4">
        {groups.map((g, gi) => (
          <div key={g.key} className={`rounded-xl border p-4 ${g.on ? "border-white/[0.08] bg-white/[0.02]" : "border-white/[0.04] bg-transparent opacity-60"}`}>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={g.on} onChange={(e) => patchGroup(gi, { on: e.target.checked })}
                  className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" />
                <span className="badge badge-blue">{g.assemblyKind}{g.ratioStr ? ` ${g.ratioStr}` : ""}{g.thickness ? ` · ${g.thickness}mm` : ""}</span>
              </label>
              <span className="text-xs text-[#8b95a7]">{g.rows.length} row(s)</span>
              {g.existing && (
                <button type="button" className="badge badge-muted transition hover:text-white" disabled={busy || done}
                  onClick={() => patchGroup(gi, { useExisting: !g.useExisting })}>
                  {g.useExisting ? `using existing: ${g.existing.name} — switch to create new` : "switch to existing match"}
                </button>
              )}
            </div>
            {g.repairNote && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-accent-300">
                <IconAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />{g.repairNote}
              </p>
            )}
            {g.contextNote && <p className="mt-1.5 text-xs text-[#8b95a7]">{g.contextNote}</p>}

            {!(g.useExisting && g.existing) && (
              <>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  <div className="sm:col-span-2">
                    <label className="label">Assembly name</label>
                    <input className="input py-1.5" value={g.name} disabled={busy || done}
                      onChange={(e) => patchGroup(gi, { name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Mix ratio</label>
                    <input className="input py-1.5" placeholder="e.g. 1:2:4" value={g.ratioStr ?? ""} disabled={busy || done}
                      onChange={(e) => onRatioEdit(gi, e.target.value)} />
                  </div>
                  <div>
                    <label className="label">Output unit</label>
                    <input className="input py-1.5" value={g.unit} disabled={busy || done}
                      onChange={(e) => patchGroup(gi, { unit: e.target.value })} />
                  </div>
                </div>

                {g.comps.length > 0 ? (
                  <>
                    {g.working && <p className="mt-3 text-xs text-[#8b95a7]">Working: {g.working} — quantities below are editable.</p>}
                    <div className="mt-2 overflow-x-auto">
                      <table className="table-base min-w-[560px]">
                        <thead><tr><th>Component</th><th>Qty / {g.unit || "unit"}</th><th>Unit</th><th>Waste ×</th><th className="text-right">Price</th></tr></thead>
                        <tbody>
                          {g.comps.map((c, ci) => (
                            <tr key={c.role}>
                              <td>
                                <select className="select py-1.5" value={c.materialId ?? "__new__"} disabled={busy || done}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    if (v === "__new__") patchComp(gi, ci, { materialId: null });
                                    else {
                                      const m = materials.find((x) => x.id === v);
                                      patchComp(gi, ci, { materialId: v, name: m?.name ?? c.name });
                                    }
                                  }}>
                                  <option value="__new__">+ will be created: {c.name}</option>
                                  {materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                                </select>
                              </td>
                              <td><input type="number" step="0.001" className="input w-24 py-1.5" value={c.qty} disabled={busy || done}
                                onChange={(e) => patchComp(gi, ci, { qty: e.target.value })} /></td>
                              <td className="text-[#8b95a7]">{c.unit}</td>
                              <td><input type="number" step="0.01" className="input w-20 py-1.5" value={c.waste} disabled={busy || done}
                                onChange={(e) => patchComp(gi, ci, { waste: e.target.value })} /></td>
                              <td className="text-right font-mono text-xs text-[#8b95a7]">
                                {c.materialId && prices[c.materialId] != null ? ngn(prices[c.materialId]) : "unpriced"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-accent-300">
                    No breakdown could be derived for this work — the assembly is created without components; add them on /assemblies.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-[#c7cedb]">Implied labour+plant+OH&amp;P:</span>
                  <span className="flex items-center gap-1">
                    <span className="text-[#8b95a7]">₦</span>
                    <input type="number" min="0" className="input w-28 py-1.5" value={g.labour} disabled={busy || done}
                      onChange={(e) => patchGroup(gi, { labour: e.target.value })} />
                    <span className="text-[#8b95a7]">per {g.unit || "unit"}</span>
                  </span>
                  {g.labourFromBill ? (
                    <span className="text-xs text-emerald-300/80">(stated by the bill — it prices labour separately)</span>
                  ) : g.avgRate != null ? (
                    <span className="text-xs text-[#8b95a7]">
                      (BOQ rate {ngn(g.avgRate)} − materials {ngn(matCostOf(g))}{g.comps.some((c) => !c.materialId || prices[c.materialId!] == null) ? ", unpriced components counted at ₦0" : ""})
                    </span>
                  ) : (
                    <span className="text-xs text-[#8b95a7]">(no BOQ rate on these rows — set the labour yourself)</span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}

        {groups.length > 0 && (
          <button className="btn btn-primary" disabled={busy || done || selected.length === 0} onClick={confirmAll}>
            {busy ? "Creating…" : `Create ${createCount} assembl${createCount === 1 ? "y" : "ies"} & attach to ${itemCount} item${itemCount === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
    </div>
  );
}
