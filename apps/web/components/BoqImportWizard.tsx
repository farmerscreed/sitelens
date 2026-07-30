"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconUpload, IconAlert, IconLayers, IconChevron } from "@/components/icons";

type Type = { id: string; name: string };
type Kind = "sheet" | "pdf" | "image" | "unknown";

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
  sheet: "Spreadsheet — parsed here, understood by the extraction brain",
  pdf: "PDF — read by AI vision",
  image: "Photo / scan — read by AI vision",
  unknown: "Unrecognised type",
};
const KIND_BADGE: Record<Kind, string> = {
  sheet: "badge-blue", pdf: "badge-accent", image: "badge-accent", unknown: "badge-red",
};

async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let bin = "";
  for (const b of buf) bin += String.fromCharCode(b);
  return btoa(bin);
}
async function fnError(error: any): Promise<string> {
  try { const body = await error?.context?.json?.(); if (body?.error) return String(body.error); } catch { /* */ }
  return error?.message ?? String(error);
}

// BOQ import v2 (BOQ_TRUE_COST_DESIGN §10): ONE extraction brain for every format.
// Spreadsheets are parsed in the browser (SheetJS — no edge memory limit) and the raw
// grid goes to the edge function, where the document grammar is decoded, arithmetic is
// validated, and the extraction is RECONCILED against the bill's own totals. PDF/photo
// go to the same function as files. Every row is staged as a proposal you review.
export function BoqImportWizard({ orgId, types }: { orgId: string; types: Type[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("unknown");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onPick(f: File | null) {
    setFile(f); setErr(null);
    setKind(f ? detectKind(f) : "unknown");
  }

  async function start() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      let body: Record<string, unknown>;
      if (kind === "sheet") {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
        const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: true });
        // Trim the trailing all-blank tail (real bills carry hundreds of empty rows).
        let last = grid.length - 1;
        while (last >= 0 && (grid[last] ?? []).every((c) => String(c ?? "").trim() === "")) last--;
        const trimmed = grid.slice(0, last + 1);
        if (!trimmed.length) { setErr("That sheet looks empty."); return; }
        body = {
          orgId, buildingTypeId: typeId, gridRows: trimmed,
          format: file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
        };
      } else {
        const fileBase64 = await fileToBase64(file);
        const mime = file.type || (kind === "pdf" ? "application/pdf" : "image/jpeg");
        body = { orgId, buildingTypeId: typeId, fileBase64, mime };
      }
      const { data, error } = await supabase.functions.invoke("boq-extract-pdf", { body });
      if (error) { setErr(await fnError(error)); return; }
      router.push(`/boq-import/${data.importId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

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
            <Link href="/recipes" className="btn btn-primary mt-4">Go to Recipes <IconChevron className="h-4 w-4 -rotate-90" /></Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 text-sm text-[#8b95a7]">
        Upload the bill in any format — <strong className="text-[#c7cedb]">Excel, CSV, PDF or a photo</strong>. The system
        reads it the way a QS does: real items are separated from notes and totals, &quot;Ditto&quot; is resolved, units are
        normalised, and the extraction is <strong className="text-[#c7cedb]">checked against the bill&apos;s own totals</strong> before
        you review a single row.
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
          <IconUpload className="h-4 w-4" />{busy ? "Reading the bill…" : "Extract & check"}
        </button>
        {kind === "unknown" && file && <p className="mt-2 text-xs text-red-300">Unsupported file type — use Excel, CSV, PDF, or an image (JPG/PNG).</p>}
        {err && <p className="mt-3 flex items-start gap-1.5 text-sm text-red-300"><IconAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{err}</span></p>}
      </section>
    </div>
  );
}
