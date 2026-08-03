"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconUpload, IconAlert, IconLayers, IconChevron, IconCheck } from "@/components/icons";
import { buildWorkbookMap, trimGrid, ROLE_LABEL } from "@/lib/boq/workbook.mjs";

type Type = { id: string; name: string };
type Kind = "sheet" | "pdf" | "image" | "unknown";
type Progress = { step: string; done?: number; total?: number; message?: string };
type Grid = unknown[][];
type MapEntry = {
  name: string; role: string; itemCount: number; hasSplitRates: boolean;
  duplicateOf: string | null; include: boolean;
};
type RunEntry = {
  name: string; importId: string | null;
  state: "pending" | "running" | "done" | "error";
  progress: Progress | null; error: string | null;
};

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
  sheet: "Spreadsheet — every sheet is classified, you choose what imports",
  pdf: "PDF — read by AI vision",
  image: "Photo / scan — read by AI vision",
  unknown: "Unrecognised type",
};
const KIND_BADGE: Record<Kind, string> = {
  sheet: "badge-blue", pdf: "badge-accent", image: "badge-accent", unknown: "badge-red",
};
const ROLE_BADGE: Record<string, string> = {
  bill: "badge-blue", rates: "badge-accent", summary: "badge-muted",
  reference: "badge-accent", notes: "badge-muted", empty: "badge-muted", unknown: "badge-red",
};

const STEP_TEXT: Record<string, string> = {
  reading_file: "Decoding document structure",
  decoding: "Decoding document structure",
  enriching: "AI reading the bill",
  validating: "Checking arithmetic against the bill's totals",
  staging: "Staging rows for review",
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// BOQ import v3: the wizard is WORKBOOK-aware. Every sheet is parsed and
// classified in the browser (deterministic — no AI), duplicated sheets are
// caught (a cumulative sheet repeating the per-floor sheets would double-count
// the money), and the human confirms the map before anything imports (Rule 3).
// Each included bill sheet then runs through the ONE extraction brain as its
// own import — review, confirm and bootstrap are unchanged.
export function BoqImportWizard({ orgId, types }: { orgId: string; types: Type[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("unknown");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<{ stages: number; mats: number } | null>(null);

  // Workbook state (sheet lane).
  const [wbMap, setWbMap] = useState<MapEntry[] | null>(null);
  const gridsRef = useRef<Record<string, Grid>>({});
  const [runs, setRuns] = useState<RunEntry[] | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current); }, []);

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

  async function onPick(f: File | null) {
    setFile(f); setErr(null); setWbMap(null); setRuns(null);
    const k = f ? detectKind(f) : "unknown";
    setKind(k);
    if (!f || k !== "sheet") return;
    // Parse and classify the whole workbook right away — the map is the next screen.
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: "array" });
      const sheets = wb.SheetNames.map((name) => ({
        name,
        grid: trimGrid(XLSX.utils.sheet_to_json<any[]>(wb.Sheets[name], { header: 1, defval: "", blankrows: true })) as Grid,
      }));
      gridsRef.current = Object.fromEntries(sheets.map((s) => [s.name, s.grid]));
      const map = buildWorkbookMap(sheets) as MapEntry[];
      if (!map.some((e) => e.role === "bill")) {
        setErr("No sheet in this workbook looks like a bill (Description + Qty columns). Check the file.");
        setWbMap(map);
      } else {
        setWbMap(map);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const toggleInclude = (name: string) =>
    setWbMap((m) => (m ? m.map((e) => (e.name === name ? { ...e, include: !e.include } : e)) : m));

  const updateRun = (name: string, p: Partial<RunEntry>) =>
    setRuns((rs) => (rs ? rs.map((r) => (r.name === name ? { ...r, ...p } : r)) : rs));

  // Wait until the import row reaches review (or reports an error). Survives a
  // dropped invoke: the edge function keeps writing progress onto the row.
  async function waitForReview(
    importId: string, name: string, invokeErr: () => string | null,
  ): Promise<string | null> {
    const t0 = Date.now();
    let sawProgress = false;
    while (Date.now() - t0 < 4 * 60 * 1000) {
      const { data } = await supabase.from("boq_imports").select("status,progress").eq("id", importId).single();
      const p = (data?.progress ?? null) as Progress | null;
      if (p) { sawProgress = true; updateRun(name, { progress: p }); }
      if (p?.step === "error") return p.message ?? "Extraction failed.";
      if (data?.status === "review") return null;
      const ie = invokeErr();
      if (ie && !sawProgress && Date.now() - t0 > 8000) return ie; // invoke died before the edge fn ever ran
      await sleep(2000);
    }
    return "Timed out waiting for the extraction — check the import list.";
  }

  // Import every included bill sheet, one at a time, through the existing pipeline.
  async function runImports() {
    if (!wbMap) return;
    const picked = wbMap.filter((e) => e.include && e.role === "bill");
    if (picked.length === 0) return;
    setBusy(true); setErr(null); setElapsed(0);
    const t0 = Date.now();
    tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    const fmt = file?.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx";
    setRuns(picked.map((e) => ({ name: e.name, importId: null, state: "pending", progress: null, error: null })));

    for (const entry of picked) {
      updateRun(entry.name, { state: "running" });
      const { data: importId, error: cErr } = await supabase.rpc("fn_create_boq_import", {
        p_org: orgId, p_building_type: typeId, p_format: fmt, p_source_media: null,
      });
      if (cErr) { updateRun(entry.name, { state: "error", error: cErr.message }); continue; }
      updateRun(entry.name, { importId });

      let invokeError: string | null = null;
      supabase.functions
        .invoke("boq-extract-pdf", {
          body: { orgId, buildingTypeId: typeId, gridRows: gridsRef.current[entry.name], format: fmt, sheetLabel: entry.name, importId },
        })
        .then(async ({ error }) => { if (error) invokeError = await fnError(error); })
        .catch((e) => { invokeError = e instanceof Error ? e.message : String(e); });

      const failure = await waitForReview(importId, entry.name, () => invokeError);
      updateRun(entry.name, failure ? { state: "error", error: failure } : { state: "done" });
    }

    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setBusy(false);
    setRuns((rs) => {
      // Single-sheet workbooks keep the old snappy flow: straight to review.
      if (rs && rs.length === 1 && rs[0].state === "done" && rs[0].importId) {
        router.push(`/boq-import/${rs[0].importId}`);
      }
      return rs;
    });
  }

  // PDF / photo lane — unchanged single-import flow.
  async function startFileLane() {
    if (!file) return;
    setBusy(true); setErr(null); setElapsed(0);
    const t0 = Date.now();
    tickRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    try {
      const fileBase64 = await fileToBase64(file);
      const mime = file.type || (kind === "pdf" ? "application/pdf" : "image/jpeg");
      const format = kind === "pdf" ? "pdf" : (mime.split("/")[1] || "image").slice(0, 10);
      const { data: importId, error: cErr } = await supabase.rpc("fn_create_boq_import", {
        p_org: orgId, p_building_type: typeId, p_format: format, p_source_media: null,
      });
      if (cErr) { setErr(cErr.message); return; }
      setRuns([{ name: file.name, importId, state: "running", progress: null, error: null }]);
      let invokeError: string | null = null;
      supabase.functions
        .invoke("boq-extract-pdf", { body: { orgId, buildingTypeId: typeId, fileBase64, mime, importId } })
        .then(async ({ error }) => { if (error) invokeError = await fnError(error); })
        .catch((e) => { invokeError = e instanceof Error ? e.message : String(e); });
      const failure = await waitForReview(importId, file.name, () => invokeError);
      if (failure) { updateRun(file.name, { state: "error", error: failure }); setErr(failure); }
      else router.push(`/boq-import/${importId}`);
    } finally {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
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

  const pickedBills = wbMap?.filter((e) => e.include && e.role === "bill") ?? [];
  const doneRuns = runs?.filter((r) => r.state === "done" && r.importId) ?? [];
  const allSettled = !!runs && runs.every((r) => r.state === "done" || r.state === "error");

  return (
    <div className="max-w-3xl space-y-4">
      <div className="rounded-2xl border border-white/[0.06] bg-white/[0.015] p-4 text-sm text-[#8b95a7]">
        Upload the bill in any format — <strong className="text-[#c7cedb]">Excel, CSV, PDF or a photo</strong>. A multi-sheet
        workbook is read <strong className="text-[#c7cedb]">whole</strong>: every sheet is classified (bills, rates, schedules,
        summaries), duplicated sheets are caught so nothing double-counts, and you confirm the map before anything imports.
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
            <select className="select" value={typeId} onChange={(e) => setTypeId(e.target.value)} disabled={busy || !!runs}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">BOQ file — Excel, CSV, PDF or photo</label>
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-white/[0.15] bg-white/[0.02] px-3.5 py-2.5 text-sm text-[#8b95a7] transition hover:border-accent-500/40 hover:text-white">
              <IconUpload className="h-4 w-4 shrink-0" />
              <span className="truncate">{file ? file.name : "Choose a file…"}</span>
              <input type="file" accept=".xlsx,.xls,.csv,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,image/*" className="hidden"
                disabled={busy || !!runs}
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

        {kind !== "sheet" && (
          <button className="btn btn-primary mt-4" disabled={busy || !!runs || !file || !typeId || kind === "unknown"} onClick={startFileLane}>
            <IconUpload className="h-4 w-4" />{busy ? "Reading the bill…" : "Extract & check"}
          </button>
        )}
        {kind === "unknown" && file && <p className="mt-2 text-xs text-red-300">Unsupported file type — use Excel, CSV, PDF, or an image (JPG/PNG).</p>}
        {err && <p className="mt-3 flex items-start gap-1.5 text-sm text-red-300"><IconAlert className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{err}</span></p>}
      </section>

      {/* The workbook map — the human confirms what each sheet IS before import. */}
      {wbMap && !runs && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Workbook map — {wbMap.length} sheet{wbMap.length === 1 ? "" : "s"}</h2>
          <p className="mt-1 text-xs text-[#8b95a7]">
            Ticked bill sheets import into the recipe (one reviewable import each). Rates, schedule and summary
            sheets are recognised for the follow-up steps; duplicated sheets are pre-excluded so nothing counts twice.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="table-base min-w-[640px]">
              <thead>
                <tr><th>Import</th><th className="min-w-[12rem]">Sheet</th><th>Detected as</th><th>Items</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {wbMap.map((e) => (
                  <tr key={e.name} className={e.duplicateOf ? "opacity-70" : ""}>
                    <td>
                      <input type="checkbox" checked={e.include} disabled={e.role !== "bill"}
                        onChange={() => toggleInclude(e.name)}
                        className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" />
                    </td>
                    <td className="text-white">{e.name}</td>
                    <td><span className={`badge ${ROLE_BADGE[e.role] ?? "badge-muted"}`}>{(ROLE_LABEL as Record<string, string>)[e.role] ?? e.role}</span></td>
                    <td className="text-[#8b95a7]">{e.role === "bill" ? e.itemCount : "—"}</td>
                    <td className="space-x-1">
                      {e.hasSplitRates && <span className="badge badge-blue">material + labour rates</span>}
                      {e.duplicateOf && <span className="badge badge-red">duplicates “{e.duplicateOf}”</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="btn btn-primary mt-4" disabled={busy || pickedBills.length === 0 || !typeId} onClick={runImports}>
            <IconUpload className="h-4 w-4" />
            {busy ? "Working…" : `Extract & check ${pickedBills.length} bill sheet${pickedBills.length === 1 ? "" : "s"}`}
          </button>
        </section>
      )}

      {/* Live progress + results, one row per sheet. */}
      {runs && (
        <section className="card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-white">{allSettled ? "Extraction finished" : "Reading the workbook"}</h2>
            {!allSettled && <span className="font-mono text-xs text-[#8b95a7]">{elapsed}s</span>}
          </div>
          <ol className="mt-4 space-y-3">
            {runs.map((r) => (
              <li key={r.name} className="flex items-start gap-3 text-sm">
                {r.state === "done" ? (
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"><IconCheck className="h-3.5 w-3.5" /></span>
                ) : r.state === "error" ? (
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-500/15 text-red-300"><IconAlert className="h-3.5 w-3.5" /></span>
                ) : r.state === "running" ? (
                  <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-accent-400 border-t-transparent" />
                ) : (
                  <span className="grid h-5 w-5 shrink-0 place-items-center"><span className="h-1.5 w-1.5 rounded-full bg-white/20" /></span>
                )}
                <div className="min-w-0">
                  <span className={r.state === "pending" ? "text-[#5b6473]" : "text-white"}>{r.name}</span>
                  {r.state === "running" && r.progress && (
                    <span className="ml-2 text-xs text-accent-300">
                      {STEP_TEXT[r.progress.step] ?? r.progress.step}
                      {r.progress.step === "enriching" && (r.progress.total ?? 0) > 0 && ` — element ${r.progress.done ?? 0} of ${r.progress.total}`}
                    </span>
                  )}
                  {r.state === "done" && r.importId && (
                    <Link href={`/boq-import/${r.importId}`} className="ml-2 text-xs text-accent-300 underline-offset-2 hover:underline">
                      review →
                    </Link>
                  )}
                  {r.state === "error" && <p className="mt-0.5 break-words text-xs text-red-300">{r.error}</p>}
                </div>
              </li>
            ))}
          </ol>
          {!allSettled && <p className="mt-3 text-xs text-[#5b6473]">Large bills can take a couple of minutes each — sheets run one at a time.</p>}
          {allSettled && doneRuns.length > 1 && (
            <p className="mt-4 text-sm text-[#8b95a7]">
              {doneRuns.length} import{doneRuns.length === 1 ? "" : "s"} staged — review and confirm each one
              (start with the first; stages and materials you bootstrap there carry over to the rest).
            </p>
          )}
        </section>
      )}
    </div>
  );
}
