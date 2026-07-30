"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconUpload, IconAlert, IconLayers, IconChevron, IconCheck } from "@/components/icons";

type Type = { id: string; name: string };
type Kind = "sheet" | "pdf" | "image" | "unknown";
type Progress = { step: string; done?: number; total?: number; message?: string };

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

// The extraction pipeline as the user sees it (progress.step → stepper position).
const STEPS = [
  { label: "Decoding document structure" },
  { label: "AI reading the bill" },
  { label: "Checking arithmetic against the bill's totals" },
  { label: "Staging rows for review" },
];
const STEP_INDEX: Record<string, number> = {
  reading_file: 0, decoding: 0, enriching: 1, validating: 2, staging: 3,
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
// validated, and the extraction is RECONCILED against the bill's own totals. The import
// row is created FIRST (fn_create_boq_import) so the edge function can report live
// progress onto it — the wizard polls and shows a real stepper, surviving slow reads.
export function BoqImportWizard({ orgId, types }: { orgId: string; types: Type[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("unknown");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [readiness, setReadiness] = useState<{ stages: number; mats: number } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneRef = useRef(false);

  function stopTimers() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
  }
  useEffect(() => stopTimers, []);

  // Readiness note — informational only, never a gate: the bill can BOOTSTRAP both
  // stages and materials after extraction (fn_bootstrap_* on the review page).
  useEffect(() => {
    if (!typeId) { setReadiness(null); return; }
    let live = true;
    (async () => {
      const [{ count: stages }, { count: mats }] = await Promise.all([
        supabase.from("type_stages").select("id", { count: "exact", head: true }).eq("building_type_id", typeId),
        supabase.from("materials_catalog").select("id", { count: "exact", head: true }),
      ]);
      if (live) setReadiness({ stages: stages ?? 0, mats: mats ?? 0 });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

  function onPick(f: File | null) {
    setFile(f); setErr(null);
    setKind(f ? detectKind(f) : "unknown");
  }

  function finish(fn: () => void) {
    if (doneRef.current) return;
    doneRef.current = true;
    stopTimers();
    fn();
  }

  async function start() {
    if (!file) return;
    setBusy(true); setErr(null); setProgress(null); setElapsed(0);
    doneRef.current = false;
    try {
      let body: Record<string, unknown>;
      let format: string;
      if (kind === "sheet") {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
        const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: true });
        // Trim the trailing all-blank tail (real bills carry hundreds of empty rows).
        let last = grid.length - 1;
        while (last >= 0 && (grid[last] ?? []).every((c) => String(c ?? "").trim() === "")) last--;
        const trimmed = grid.slice(0, last + 1);
        if (!trimmed.length) { setErr("That sheet looks empty."); setBusy(false); return; }
        format = file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
        body = { orgId, buildingTypeId: typeId, gridRows: trimmed, format };
      } else {
        const fileBase64 = await fileToBase64(file);
        const mime = file.type || (kind === "pdf" ? "application/pdf" : "image/jpeg");
        format = kind === "pdf" ? "pdf" : (mime.split("/")[1] || "image").slice(0, 10);
        body = { orgId, buildingTypeId: typeId, fileBase64, mime };
      }

      // 1) Create the import row first — the anchor the edge fn reports progress onto.
      const { data: importId, error: cErr } = await supabase.rpc("fn_create_boq_import", {
        p_org: orgId, p_building_type: typeId, p_format: format, p_source_media: null,
      });
      if (cErr) { setErr(cErr.message); setBusy(false); return; }

      // 2) Poll the row while the extraction runs (survives a dropped invoke).
      const t0 = Date.now();
      tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
      pollRef.current = setInterval(async () => {
        const { data } = await supabase.from("boq_imports").select("status,progress").eq("id", importId).single();
        if (!data || doneRef.current) return;
        const p = (data.progress ?? null) as Progress | null;
        if (p) setProgress(p);
        if (p?.step === "error") {
          finish(() => { setErr(p.message ?? "Extraction failed."); setBusy(false); });
        } else if (data.status === "review") {
          finish(() => router.push(`/boq-import/${importId}`));
        }
      }, 2000);

      // 3) Kick off the extraction itself.
      const { error } = await supabase.functions.invoke("boq-extract-pdf", { body: { ...body, importId } });
      if (doneRef.current) return; // the poller already navigated or surfaced the error
      if (error) {
        const t = await fnError(error);
        finish(() => { setErr(t); setBusy(false); });
        return;
      }
      finish(() => router.push(`/boq-import/${importId}`));
    } catch (e) {
      finish(() => { setErr(e instanceof Error ? e.message : String(e)); setBusy(false); });
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

  const stepCur = progress ? (STEP_INDEX[progress.step] ?? 0) : 0;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 text-sm text-[#8b95a7]">
        Upload the bill in any format — <strong className="text-[#c7cedb]">Excel, CSV, PDF or a photo</strong>. The system
        reads it the way a QS does: real items are separated from notes and totals, &quot;Ditto&quot; is resolved, units are
        normalised, and the extraction is <strong className="text-[#c7cedb]">checked against the bill&apos;s own totals</strong> before
        you review a single row.
      </div>

      {readiness && (
        <div className={`rounded-2xl border p-4 text-sm ${
          readiness.stages === 0 || readiness.mats === 0
            ? "border-accent-500/30 bg-accent-500/[0.06] text-accent-200"
            : "border-white/[0.06] bg-white/[0.015] text-[#8b95a7]"}`}>
          This recipe has <strong className="text-[#c7cedb]">{readiness.stages} stage{readiness.stages === 1 ? "" : "s"}</strong> and
          your catalog has <strong className="text-[#c7cedb]">{readiness.mats} material{readiness.mats === 1 ? "" : "s"}</strong> —
          that&apos;s fine: you can create both directly from the bill after extraction.
        </div>
      )}

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

      {/* Live progress — polled from boq_imports.progress every 2 s. */}
      {busy && (
        <section className="card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">Reading the bill</h2>
            <span className="font-mono text-xs text-[#8b95a7]">{elapsed}s</span>
          </div>
          <ol className="mt-4 space-y-3">
            {STEPS.map((s, i) => {
              const done = i < stepCur;
              const current = i === stepCur;
              return (
                <li key={s.label} className="flex items-center gap-3 text-sm">
                  {done ? (
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300">
                      <IconCheck className="h-3.5 w-3.5" />
                    </span>
                  ) : current ? (
                    <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
                  ) : (
                    <span className="grid h-5 w-5 shrink-0 place-items-center">
                      <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                    </span>
                  )}
                  <span className={done ? "text-[#8b95a7]" : current ? "text-white" : "text-[#5b6473]"}>
                    {s.label}
                    {current && i === 1 && progress?.step === "enriching" && (progress.total ?? 0) > 0 && (
                      <span className="ml-2 font-mono text-xs text-accent-300">element {progress.done ?? 0} of {progress.total}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-[#5b6473]">Large bills can take a couple of minutes — you&apos;ll land on the review page automatically.</p>
        </section>
      )}
    </div>
  );
}
