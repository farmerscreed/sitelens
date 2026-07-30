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
  sheet: "Spreadsheet — read in your browser, you map the columns",
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
const sigOf = (headers: string[]) => headers.map((h) => h.trim().toLowerCase()).join("|");

export function BoqImportWizard({ orgId, types }: { orgId: string; types: Type[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("unknown");
  const [headers, setHeaders] = useState<string[] | null>(null);
  const [rows, setRows] = useState<any[][]>([]);
  const [map, setMap] = useState({ item: 0, quantity: 1, unit: 2, rate: -1 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function onPick(f: File | null) {
    setFile(f); setHeaders(null); setRows([]); setErr(null);
    setKind(f ? detectKind(f) : "unknown");
  }

  // Spreadsheets are parsed IN THE BROWSER (no edge-function memory limit / cold start).
  async function start() {
    if (!file) return;
    setBusy(true); setErr(null);
    try {
      if (kind === "sheet") {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: "array" });
        const grid = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false });
        if (!grid.length) { setErr("That sheet looks empty."); return; }
        const hs = (grid[0] as any[]).map((h) => String(h ?? ""));
        setHeaders(hs);
        setRows(grid.slice(1) as any[][]);
        // Pre-fill a remembered mapping for this header layout, if any.
        const { data: mem } = await supabase.from("boq_column_mappings").select("mapping").eq("header_signature", sigOf(hs)).maybeSingle();
        const m = (mem as any)?.mapping;
        if (m) setMap({ item: m.item ?? 0, quantity: m.quantity ?? 1, unit: m.unit ?? -1, rate: m.rate ?? -1 });
      } else {
        // PDF / image → server-side AI vision (needs the API key).
        const fileBase64 = await fileToBase64(file);
        const mime = file.type || (kind === "pdf" ? "application/pdf" : "image/jpeg");
        const { data, error } = await supabase.functions.invoke("boq-extract-pdf", { body: { fileBase64, orgId, buildingTypeId: typeId, mime } });
        if (error) { setErr(await fnError(error)); return; }
        router.push(`/boq-import/${data.importId}`);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Stage the mapped spreadsheet rows straight through the RPCs (client is authenticated).
  async function stage() {
    if (!headers) return;
    setBusy(true); setErr(null);
    try {
      const staged = rows
        .filter((r) => String(r[map.item] ?? "").trim() !== "")
        .map((r) => ({
          raw_text: String(r[map.item] ?? "").trim(),
          parsed_qty: r[map.quantity] != null ? String(r[map.quantity]) : "",
          parsed_unit: map.unit >= 0 ? String(r[map.unit] ?? "") : "",
          parsed_rate: map.rate >= 0 && r[map.rate] != null ? String(r[map.rate]) : "",
        }));
      if (!staged.length) { setErr("No rows found in the 'Item' column — check the mapping."); return; }
      const fmt = (file?.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx");
      const { data: importId, error: e1 } = await supabase.rpc("fn_create_boq_import", {
        p_org: orgId, p_building_type: typeId, p_format: fmt, p_source_media: null,
      });
      if (e1) { setErr(e1.message); return; }
      const { error: e2 } = await supabase.rpc("fn_stage_boq_rows", { p_import: importId, p_rows: staged });
      if (e2) { setErr(e2.message); return; }
      const mapping: Record<string, number> = { item: map.item, quantity: map.quantity };
      if (map.unit >= 0) mapping.unit = map.unit;
      if (map.rate >= 0) mapping.rate = map.rate;
      await supabase.rpc("fn_remember_column_mapping", { p_org: orgId, p_signature: sigOf(headers), p_mapping: mapping });
      router.push(`/boq-import/${importId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const colOptions = (headers ?? []).map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>);

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

  const cta = kind === "sheet" ? "Read spreadsheet" : kind === "unknown" ? "Continue" : "Extract with AI";

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

      {headers && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Map the columns</h2>
          <p className="mt-0.5 text-xs text-[#8b95a7]">{rows.length} row(s) found. Tell us which column is which.</p>
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
