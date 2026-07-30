"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconUpload, IconAlert, IconLayers, IconChevron } from "@/components/icons";

type Type = { id: string; name: string };
type Inspect = { headers: string[]; headerSignature: string; sampleRows: unknown[][] };
type Kind = "sheet" | "pdf" | "image" | "unknown";

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}

// Auto-detect the BOQ format from the file (extension first, then MIME).
function detectKind(f: File): Kind {
  const n = f.name.toLowerCase();
  if (n.endsWith(".pdf")) return "pdf";
  if (/\.(xlsx|xls|csv)$/.test(n)) return "sheet";
  if (/\.(jpe?g|png|webp|heic|heif)$/.test(n)) return "image";
  if (f.type === "application/pdf") return "pdf";
  if (f.type.startsWith("image/")) return "image";
  if (/(sheet|excel|csv)/.test(f.type)) return "sheet";
  return "unknown";
}
const KIND_LABEL: Record<Kind, string> = {
  sheet: "Spreadsheet — parsed directly, you map the columns",
  pdf: "PDF — read by AI vision",
  image: "Photo / scan — read by AI vision",
  unknown: "Unrecognised type",
};
const KIND_BADGE: Record<Kind, string> = {
  sheet: "badge-blue", pdf: "badge-accent", image: "badge-accent", unknown: "badge-red",
};

// Edge functions return their real error in the response body; supabase-js only gives a
// generic "non-2xx" message. Dig the body out so the user sees what actually went wrong.
async function fnError(error: any): Promise<string> {
  try {
    const body = await error?.context?.json?.();
    if (body?.error) return String(body.error);
  } catch { /* body already consumed or not JSON */ }
  return error?.message ?? String(error);
}

export function BoqImportWizard({ orgId, types }: { orgId: string; types: Type[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("unknown");
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [map, setMap] = useState({ item: 0, quantity: 1, unit: 2, rate: -1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onPick(f: File | null) {
    setFile(f); setInspect(null); setErr(null);
    setKind(f ? detectKind(f) : "unknown");
  }

  async function start() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fileBase64 = await fileToBase64(file);
      if (kind === "sheet") {
        // Two-step: inspect columns → map → stage.
        const { data, error } = await supabase.functions.invoke("boq-parse", { body: { fileBase64 } });
        if (error) { setErr(await fnError(error)); return; }
        setInspect(data as Inspect);
      } else {
        // PDF / image → AI vision extraction, straight to review.
        const mime = file.type || (kind === "pdf" ? "application/pdf" : "image/jpeg");
        const { data, error } = await supabase.functions.invoke("boq-extract-pdf", {
          body: { fileBase64, orgId, buildingTypeId: typeId, mime },
        });
        if (error) { setErr(await fnError(error)); return; }
        router.push(`/boq-import/${data.importId}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function stage() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      const fileBase64 = await fileToBase64(file);
      const mapping = { item: map.item, quantity: map.quantity, ...(map.unit >= 0 ? { unit: map.unit } : {}), ...(map.rate >= 0 ? { rate: map.rate } : {}) };
      const { data, error } = await supabase.functions.invoke("boq-parse", { body: { fileBase64, orgId, buildingTypeId: typeId, mapping } });
      if (error) { setErr(await fnError(error)); return; }
      router.push(`/boq-import/${data.importId}`);
    } finally {
      setBusy(false);
    }
  }

  const colOptions = (inspect?.headers ?? []).map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>);

  // A BOQ populates a RECIPE (building type). You need one first.
  if (types.length === 0) {
    return (
      <section className="card max-w-2xl">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent-500/30 bg-accent-500/10 text-accent-300"><IconLayers className="h-5 w-5" /></span>
          <div>
            <h2 className="text-sm font-semibold text-white">Create a recipe first</h2>
            <p className="mt-1 text-sm text-[#8b95a7]">
              A BOQ fills in the material quantities of a <strong className="text-[#c7cedb]">building type (recipe)</strong>.
              You don&apos;t have one yet — create a recipe, then come back here to import its BOQ.
            </p>
            <Link href="/recipes" className="btn btn-primary mt-4">
              Go to Recipes <IconChevron className="h-4 w-4 -rotate-90" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const cta = kind === "sheet" ? "Inspect columns" : kind === "unknown" ? "Continue" : "Extract with AI";

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 text-sm text-[#8b95a7]">
        A BOQ populates the material quantities of a <strong className="text-[#c7cedb]">recipe</strong>. Pick which recipe to fill and
        upload the bill in any format — <strong className="text-[#c7cedb]">Excel, CSV, PDF or a photo</strong>. The format is detected
        automatically, and every extracted row becomes a proposal you review before it&apos;s saved.
      </div>

      <section className="card">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Populate building type</label>
            <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">BOQ file — Excel, CSV, PDF or photo</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/[0.15] bg-white/[0.02] px-3.5 py-2.5 text-sm text-[#8b95a7] transition hover:border-accent-500/40 hover:text-white">
              <IconUpload className="h-4 w-4 shrink-0" />
              <span className="truncate">{file ? file.name : "Choose a file…"}</span>
              <input type="file" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,image/*" className="hidden"
                onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
            </label>
          </div>
        </div>

        {file && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs text-[#5b6473]">Detected format:</span>
            <span className={`badge ${KIND_BADGE[kind]}`}>{KIND_LABEL[kind]}</span>
          </div>
        )}

        <button className="btn btn-primary mt-4" disabled={busy || !file || !typeId || kind === "unknown"} onClick={start}>
          <IconUpload className="h-4 w-4" />{busy ? "Working…" : cta}
        </button>
        {kind === "unknown" && file && <p className="mt-2 text-xs text-red-300">Unsupported file type — use Excel, CSV, PDF, or an image (JPG/PNG).</p>}
        {err && <p className="mt-3 flex items-start gap-1.5 text-sm text-red-300"><IconAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{err}</span></p>}
      </section>

      {inspect && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Map the columns</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div><label className="label">Item</label><select className="select" value={map.item} onChange={(e) => setMap({ ...map, item: +e.target.value })}>{colOptions}</select></div>
            <div><label className="label">Quantity</label><select className="select" value={map.quantity} onChange={(e) => setMap({ ...map, quantity: +e.target.value })}>{colOptions}</select></div>
            <div><label className="label">Unit</label><select className="select" value={map.unit} onChange={(e) => setMap({ ...map, unit: +e.target.value })}><option value={-1}>—</option>{colOptions}</select></div>
            <div><label className="label">Rate</label><select className="select" value={map.rate} onChange={(e) => setMap({ ...map, rate: +e.target.value })}><option value={-1}>—</option>{colOptions}</select></div>
          </div>
          <p className="mt-2 text-xs text-[#8b95a7]">The mapping is remembered per org for this header layout.</p>
          <button className="btn btn-primary mt-4" disabled={busy} onClick={stage}>{busy ? "Staging…" : "Stage rows for review"}</button>
        </section>
      )}
    </div>
  );
}
