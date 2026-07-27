"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Type = { id: string; name: string };
type Inspect = { headers: string[]; headerSignature: string; sampleRows: unknown[][] };

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function BoqImportWizard({ orgId, types }: { orgId: string; types: Type[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [map, setMap] = useState({ item: 0, quantity: 1, unit: 2, rate: -1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isPdf = file?.name.toLowerCase().endsWith(".pdf");

  async function inspectFile() {
    if (!file) return;
    setBusy(true); setErr(null);
    const fileBase64 = await fileToBase64(file);
    const fn = isPdf ? "boq-extract-pdf" : "boq-parse";
    if (isPdf) {
      // PDF lane extracts + stages directly (rows are proposals).
      const { data, error } = await supabase.functions.invoke(fn, {
        body: { fileBase64, orgId, buildingTypeId: typeId },
      });
      setBusy(false);
      if (error) setErr(error.message);
      else router.push(`/boq-import/${data.importId}`);
      return;
    }
    const { data, error } = await supabase.functions.invoke(fn, { body: { fileBase64 } });
    setBusy(false);
    if (error) setErr(error.message);
    else setInspect(data as Inspect);
  }

  async function stage() {
    if (!file) return;
    setBusy(true); setErr(null);
    const fileBase64 = await fileToBase64(file);
    const mapping = {
      item: map.item, quantity: map.quantity,
      ...(map.unit >= 0 ? { unit: map.unit } : {}),
      ...(map.rate >= 0 ? { rate: map.rate } : {}),
    };
    const { data, error } = await supabase.functions.invoke("boq-parse", {
      body: { fileBase64, orgId, buildingTypeId: typeId, mapping },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else router.push(`/boq-import/${data.importId}`);
  }

  const colOptions = (inspect?.headers ?? []).map((h, i) => (
    <option key={i} value={i}>{h || `Column ${i + 1}`}</option>
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-neutral-500">Populate type</label>
        <select className="rounded-md border border-neutral-300 px-2 py-1 dark:border-neutral-700 dark:bg-neutral-900"
          value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setInspect(null); }} />
        <button className="rounded-md bg-neutral-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          disabled={busy || !file || !typeId} onClick={inspectFile}>
          {busy ? "Working…" : isPdf ? "Extract (PDF)" : "Inspect columns"}
        </button>
      </div>

      {inspect && (
        <div className="space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <h2 className="text-sm font-medium">Map the columns</h2>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <label>Item<select className="mt-1 w-full rounded border px-1 dark:bg-neutral-900" value={map.item} onChange={(e) => setMap({ ...map, item: +e.target.value })}>{colOptions}</select></label>
            <label>Quantity<select className="mt-1 w-full rounded border px-1 dark:bg-neutral-900" value={map.quantity} onChange={(e) => setMap({ ...map, quantity: +e.target.value })}>{colOptions}</select></label>
            <label>Unit<select className="mt-1 w-full rounded border px-1 dark:bg-neutral-900" value={map.unit} onChange={(e) => setMap({ ...map, unit: +e.target.value })}><option value={-1}>—</option>{colOptions}</select></label>
            <label>Rate<select className="mt-1 w-full rounded border px-1 dark:bg-neutral-900" value={map.rate} onChange={(e) => setMap({ ...map, rate: +e.target.value })}><option value={-1}>—</option>{colOptions}</select></label>
          </div>
          <p className="text-xs text-neutral-500">The mapping is remembered per org for this header layout.</p>
          <button className="rounded-md bg-neutral-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
            disabled={busy} onClick={stage}>{busy ? "Staging…" : "Stage rows for review"}</button>
        </div>
      )}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
