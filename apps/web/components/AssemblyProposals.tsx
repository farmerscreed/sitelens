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
  unit: string | null;
};
export type ProposalAttachment = { assemblyId: string; assemblyName: string; assemblyUnit: string; itemIds: string[] };
type Material = { id: string; name: string; unit: string };
type ExistingAssembly = { id: string; name: string; unit: string; ratio: string | null };

const BAG_LITRES = 34.5;
const GRADE_RATIO: Record<string, string> = { "15": "1:3:6", "20": "1:2:4", "25": "1:1.5:3" };
const RATIO_GRADE: Record<string, string> = { "1:3:6": "15", "1:2:4": "20", "1:1.5:3": "25" };
const ngn = (n: number | null | undefined) =>
  n == null ? "—" : `₦${Number(n).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;

function parseRatio(s: string | null | undefined): number[] | null {
  if (!s) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)(?:\s*:\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null;
  const parts = m[3] != null ? [Number(m[1]), Number(m[2]), Number(m[3])] : [Number(m[1]), Number(m[2])];
  return parts.every((p) => Number.isFinite(p) && p > 0) ? parts : null;
}

type CompDraft = {
  role: "cement" | "sand" | "granite";
  materialId: string | null;   // null → will be created on confirm
  name: string; unit: string; qty: string; waste: string;
};
type Group = {
  key: string; on: boolean; assemblyKind: string; name: string; unit: string;
  ratioStr: string | null; dryFactor: number; rows: ProposalCandidate[];
  comps: CompDraft[]; derivable: boolean;
  avgRate: number | null; labour: string;
  existing: ExistingAssembly | null; useExisting: boolean;
};

// Classify one candidate row into a mix signature: explicit mix_ratio first, then a
// ratio or "grade NN" written in the description, then trade keywords. Unrecognized
// rows are skipped (the user handles them manually on /assemblies).
function classify(c: ProposalCandidate): { assemblyKind: string; ratio: number[] | null } | null {
  const d = c.description;
  const explicit = parseRatio(c.mix_ratio) ?? parseRatio(d);
  const grade = d.match(/grade\s*(15|20|25)/i)?.[1];
  if (/blockwork/i.test(d)) return { assemblyKind: "blockwork", ratio: explicit ?? parseRatio("1:6") };
  if (/render/i.test(d)) return { assemblyKind: "render", ratio: explicit ?? parseRatio("1:4") };
  if (/screed/i.test(d)) return { assemblyKind: "screed", ratio: explicit ?? parseRatio("1:3") };
  if (/mortar/i.test(d)) return { assemblyKind: "mortar", ratio: explicit ?? parseRatio("1:6") };
  if (explicit && explicit.length === 3) return { assemblyKind: "concrete", ratio: explicit };
  if (grade) return { assemblyKind: "concrete", ratio: parseRatio(GRADE_RATIO[grade]) };
  if (/concrete/i.test(d)) return { assemblyKind: "concrete", ratio: explicit };
  return null;
}

function proposalName(assemblyKind: string, ratioStr: string | null, sampleDesc: string): string {
  if (assemblyKind === "concrete") {
    const grade = ratioStr ? RATIO_GRADE[ratioStr] : undefined;
    if (grade) return `Concrete grade ${grade} (${ratioStr})`;
    return ratioStr ? `Concrete mix ${ratioStr}` : "Concrete (custom mix)";
  }
  if (assemblyKind === "blockwork") {
    const t = sampleDesc.match(/(\d{2,3})\s*mm/i)?.[1];
    return `${t ? `${t}mm ` : ""}Blockwork (${ratioStr ?? "1:6"} mortar)`;
  }
  const label = assemblyKind[0].toUpperCase() + assemblyKind.slice(1);
  return ratioStr ? `${label} ${ratioStr}` : `${label} (custom)`;
}

// Auto-pick catalog materials for the mix components by name; a missing one is
// proposed as "will be created" (fn_upsert_material on confirm).
function pickComponent(materials: Material[], role: CompDraft["role"]): { materialId: string | null; name: string; unit: string } {
  const rx = role === "cement" ? /cement/i : role === "sand" ? /sand/i : /granite|gravel|chipping/i;
  const m = materials.find((x) => rx.test(x.name));
  if (m) return { materialId: m.id, name: m.name, unit: role === "cement" ? "bag" : "m3" };
  return {
    materialId: null,
    name: role === "cement" ? "Cement" : role === "sand" ? "Sharp sand" : "Granite",
    unit: role === "cement" ? "bag" : "m3",
  };
}

// Propose assemblies from composite BOQ lines — THE normal flow for every bill:
// group by mix signature, reuse an existing matching assembly when there is one,
// otherwise derive components (same dry-volume math as the /assemblies calculator)
// and surface the IMPLIED labour (BOQ rate − materials) as the negotiating baseline.
// Everything is editable and nothing is written until the human confirms (Rule 3).
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
      const key = `${sig.assemblyKind}|${ratioStr ?? "custom"}`;
      let g = map.get(key);
      if (!g) {
        const unit = (c.unit ?? (sig.assemblyKind === "concrete" ? "m3" : "m2")).trim();
        const isConcrete = sig.assemblyKind === "concrete";
        const dryFactor = isConcrete ? 1.54 : 1.3;
        const waste = isConcrete ? "1.03" : "1.05";
        // Per-m³ dry-volume derivation — same math as the /assemblies ratio calculator.
        const derivable = !!sig.ratio && /^m3|m³$/i.test(unit.replace(/\s/g, ""));
        let comps: CompDraft[] = [];
        if (derivable && sig.ratio) {
          const parts = sig.ratio;
          const total = parts.reduce((a, b) => a + b, 0);
          const cement = pickComponent(materials, "cement");
          const sand = pickComponent(materials, "sand");
          comps = [
            { role: "cement", ...cement, qty: ((dryFactor * (parts[0] / total) * 1000) / BAG_LITRES).toFixed(3), waste },
            { role: "sand", ...sand, qty: ((dryFactor * parts[1]) / total).toFixed(3), waste },
          ];
          if (parts.length === 3) {
            const granite = pickComponent(materials, "granite");
            comps.push({ role: "granite", ...granite, qty: ((dryFactor * parts[2]) / total).toFixed(3), waste });
          }
        }
        const existing = assemblies.find((a) =>
          (a.ratio && ratioStr && a.ratio.trim() === ratioStr) ||
          (ratioStr && RATIO_GRADE[ratioStr] && a.name.toLowerCase().includes(`grade ${RATIO_GRADE[ratioStr]}`)),
        ) ?? null;
        g = {
          key, on: true, assemblyKind: sig.assemblyKind,
          name: proposalName(sig.assemblyKind, ratioStr, c.description),
          unit, ratioStr, dryFactor, rows: [], comps, derivable,
          avgRate: null, labour: "", existing, useExisting: !!existing,
        };
        map.set(key, g);
      }
      g.rows.push(c);
    }
    // Implied labour per group: avg BOQ rate − derived material cost, floored at 0.
    for (const g of map.values()) {
      const rates = g.rows.map((r) => r.boq_rate).filter((r): r is number => r != null);
      g.avgRate = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null;
      if (g.avgRate != null) {
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
            ? <>Composite lines detected — one assembly per mix. Existing assemblies are reused; new ones derive their components from the ratio, and the <strong className="text-white">implied labour</strong> (BOQ rate − materials) is your negotiating baseline. Edit anything before confirming.</>
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
                <span className="badge badge-blue">{g.assemblyKind}{g.ratioStr ? ` ${g.ratioStr}` : ""}</span>
              </label>
              <span className="text-xs text-[#8b95a7]">{g.rows.length} row(s)</span>
              {g.existing && (
                <button type="button" className="badge badge-muted transition hover:text-white" disabled={busy || done}
                  onClick={() => patchGroup(gi, { useExisting: !g.useExisting })}>
                  {g.useExisting ? `using existing: ${g.existing.name} — switch to create new` : "switch to existing match"}
                </button>
              )}
            </div>

            {!(g.useExisting && g.existing) && (
              <>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="label">Assembly name</label>
                    <input className="input py-1.5" value={g.name} disabled={busy || done}
                      onChange={(e) => patchGroup(gi, { name: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Output unit</label>
                    <input className="input py-1.5" value={g.unit} disabled={busy || done}
                      onChange={(e) => patchGroup(gi, { unit: e.target.value })} />
                  </div>
                </div>

                {g.comps.length > 0 ? (
                  <div className="mt-3 overflow-x-auto">
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
                ) : (
                  <p className="mt-3 text-xs text-accent-300">
                    Components couldn&apos;t be derived for a {g.unit || "?"} output — the assembly is created without them; add components on /assemblies.
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
                  {g.avgRate != null ? (
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
