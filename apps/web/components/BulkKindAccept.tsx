"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { WorkItemKindSelect } from "@/components/WorkItemKindSelect";
import { IconCheck, IconAlert } from "@/components/icons";

type Item = { id: string; kind: string; description: string; element_name: string | null; section_name: string | null };

// Builder words for the summary line.
const SIMPLE: Record<string, string> = {
  composite: "mixed on site", plant: "formwork/plant", material_supply: "supply",
  labour: "labour", fitting: "fittings", provisional: "provisional",
};

// Same rules (and ORDER) as the fixed import classifier: supply words FIRST
// ("high yield bars", "12mm diameter"), then formwork/plant ("edges of",
// "sides of", "soffit"), only then the concrete family — so steel and formwork
// never get filed under concrete again.
const SUPPLY_RX = /reinforc|\bbars?\b|\bdiameter\b|stirrup|sand|cement|granite|membrane|roofing|tile/i;
const PLANT_RX = /soffit|form\s*work|shutter|edges of|sides of/i;
const COMPOSITE_RX = /concrete|blockwork|mortar|render|screed|plaster/i;
const LABOUR_RX = /excavat|clear|remove|filling|disposal|compact|protect/i;
const FITTING_RX = /door|window|wardrobe|cabinet|sink|\bwc\b|heater|rail/i;

function suggestKind(it: Item): string | null {
  const d = it.description;
  if (SUPPLY_RX.test(d)) return "material_supply";
  if (PLANT_RX.test(d)) return "plant";
  if (COMPOSITE_RX.test(d)) return "composite";
  if (LABOUR_RX.test(d)) return "labour";
  if (FITTING_RX.test(d)) return "fitting";
  const s = `${it.element_name ?? ""} ${it.section_name ?? ""}`;
  if (/form\s*work/i.test(s)) return "plant";
  if (/reinforcement/i.test(s)) return "material_supply";
  if (/concrete|blockwork|render|plaster|screed|mortar/i.test(s)) return "composite";
  if (/ironmongery|doors|windows|sanitary|fittings/i.test(s)) return "fitting";
  if (/excavation|earthwork|disposal|filling/i.test(s)) return "labour";
  if (/provisional/i.test(s)) return "provisional";
  return null;
}

// One-tap fix for two backlogs at once: lines stored 'other' (typed from their
// words + bill section) and lines stored 'composite' with no mix whose words
// clearly say steel or formwork (the old rule order filed them under concrete).
// One Accept-all applies both via fn_update_work_item — the tap IS the human
// confirmation (Rule 3). Unsuggested 'other' lines always stay in the manual list.
export function BulkKindAccept({ items }: { items: Item[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const { suggested, misTyped, unsuggested, counts } = useMemo(() => {
    const suggested: { it: Item; kind: string }[] = [];
    const misTyped: { it: Item; kind: string }[] = [];
    const unsuggested: Item[] = [];
    const counts = new Map<string, number>();
    for (const it of items) {
      if (it.kind === "composite") {
        // Re-type only when the words clearly say supply or formwork.
        const kind = SUPPLY_RX.test(it.description) ? "material_supply"
          : PLANT_RX.test(it.description) ? "plant" : null;
        if (kind) misTyped.push({ it, kind });
      } else {
        const kind = suggestKind(it);
        if (kind && kind !== "other") { suggested.push({ it, kind }); counts.set(kind, (counts.get(kind) ?? 0) + 1); }
        else unsuggested.push(it);
      }
    }
    return { suggested, misTyped, unsuggested, counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acceptAll() {
    setBusy(true); setErr(null); setOk(null);
    try {
      for (const { it, kind } of [...suggested, ...misTyped]) {
        const { error } = await supabase.rpc("fn_update_work_item", {
          p_work_item: it.id, p_kind: kind, p_assembly: null, p_material: null,
          p_clear_material: false, p_clear_assembly: false,
        });
        if (error) throw new Error(error.message);
      }
      setOk(`${suggested.length + misTyped.length} line(s) re-typed.`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return null;
  const summary = [...counts.entries()]
    .map(([k, n]) => `${n} ${SIMPLE[k] ?? k.replace("_", " ")}`)
    .join(", ");
  const manualList = showAll
    ? [...items.filter((i) => i.kind !== "composite"), ...misTyped.map((m) => m.it)]
    : unsuggested;

  return (
    <div className="mt-2 space-y-3">
      {(suggested.length > 0 || misTyped.length > 0) && !ok && (
        <div className="space-y-2 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          {suggested.length > 0 && (
            <p className="text-sm text-[#c7cedb]">
              {suggested.length} line{suggested.length === 1 ? "" : "s"} typed from their bill sections ({summary})
            </p>
          )}
          {misTyped.length > 0 && (
            <p className="text-sm text-[#c7cedb]">
              {misTyped.length} line{misTyped.length === 1 ? "" : "s"} look mis-typed (steel/formwork filed under concrete) — re-type
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={acceptAll}>
              <IconCheck className="h-3.5 w-3.5" />{busy ? "Applying…" : "Accept all"}
            </button>
            <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => setShowAll((v) => !v)}>
              {showAll ? "hide the list" : "review each"}
            </button>
          </div>
        </div>
      )}
      {ok && (
        <p className="flex items-center gap-1.5 text-sm text-emerald-300"><IconCheck className="h-4 w-4" />{ok}</p>
      )}
      {err && (
        <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>
      )}

      {manualList.length > 0 && (
        <ul className="space-y-2">
          {manualList.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/[0.02] px-3 py-2">
              <span className="min-w-0 flex-1 text-[13px] leading-snug text-[#c7cedb]">{r.description}</span>
              <WorkItemKindSelect id={r.id} kind={r.kind} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
