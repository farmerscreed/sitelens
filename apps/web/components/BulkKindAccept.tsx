"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { WorkItemKindSelect } from "@/components/WorkItemKindSelect";
import { IconCheck, IconAlert } from "@/components/icons";

type Item = { id: string; description: string; element_name: string | null; section_name: string | null };

// Builder words for the summary line.
const SIMPLE: Record<string, string> = {
  composite: "mixed on site", plant: "formwork/plant", material_supply: "supply",
  labour: "labour", fitting: "fittings", provisional: "provisional",
};

// Same rules the import classifier now applies (boq_core sectionKind), for rows
// confirmed before it existed: description first (formwork checked ahead of
// concrete — "formwork to concrete soffit" is plant, not a mix), then the bill
// section the line sits under.
function suggestKind(it: Item): string | null {
  const d = it.description;
  if (/soffit|formwork|shutter/i.test(d)) return "plant";
  if (/concrete|blockwork|mortar|render|screed|plaster/i.test(d)) return "composite";
  if (/reinforc|\bbars?\b|sand|cement|granite|membrane|roofing|tile/i.test(d)) return "material_supply";
  if (/excavat|clear|remove|filling|disposal|compact|protect/i.test(d)) return "labour";
  if (/door|window|wardrobe|cabinet|sink|\bwc\b|heater|rail/i.test(d)) return "fitting";
  const s = `${it.element_name ?? ""} ${it.section_name ?? ""}`;
  if (/formwork/i.test(s)) return "plant";
  if (/reinforcement/i.test(s)) return "material_supply";
  if (/concrete|blockwork|render|plaster|screed|mortar/i.test(s)) return "composite";
  if (/ironmongery|doors|windows|sanitary|fittings/i.test(s)) return "fitting";
  if (/excavation|earthwork|disposal|filling/i.test(s)) return "labour";
  if (/provisional/i.test(s)) return "provisional";
  return null;
}

// One-tap fix for lines stored as 'other': suggest a type from the line and its
// bill section, accept all in one go (fn_update_work_item per line — Rule 3: the
// tap IS the human confirmation), or review each. Unsuggested lines always stay
// in the manual list.
export function BulkKindAccept({ items }: { items: Item[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const { suggested, unsuggested, counts } = useMemo(() => {
    const suggested: { it: Item; kind: string }[] = [];
    const unsuggested: Item[] = [];
    const counts = new Map<string, number>();
    for (const it of items) {
      const kind = suggestKind(it);
      if (kind) { suggested.push({ it, kind }); counts.set(kind, (counts.get(kind) ?? 0) + 1); }
      else unsuggested.push(it);
    }
    return { suggested, unsuggested, counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function acceptAll() {
    setBusy(true); setErr(null); setOk(null);
    try {
      for (const { it, kind } of suggested) {
        const { error } = await supabase.rpc("fn_update_work_item", {
          p_work_item: it.id, p_kind: kind, p_assembly: null, p_material: null,
        });
        if (error) throw new Error(error.message);
      }
      setOk(`${suggested.length} line(s) typed from their bill sections.`);
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
  const manualList = showAll ? items : unsuggested;

  return (
    <div className="mt-2 space-y-3">
      {suggested.length > 0 && !ok && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
          <span className="text-sm text-[#c7cedb]">
            {suggested.length} line{suggested.length === 1 ? "" : "s"} typed from their bill sections ({summary})
          </span>
          <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={acceptAll}>
            <IconCheck className="h-3.5 w-3.5" />{busy ? "Applying…" : "Accept all"}
          </button>
          <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => setShowAll((v) => !v)}>
            {showAll ? "hide the list" : "review each"}
          </button>
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
              <WorkItemKindSelect id={r.id} kind="other" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
