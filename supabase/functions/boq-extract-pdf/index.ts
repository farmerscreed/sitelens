// Edge Function: BOQ extraction v2 (BOQ_TRUE_COST_DESIGN §10) — ONE brain, all lanes.
//  • Spreadsheets: the browser parses the grid (SheetJS, no edge OOM) and sends the
//    raw cells here; the deterministic core classifies the document grammar, the AI
//    enriches item rows (kind/stage/material/mix).
//  • PDF / photo: the AI extracts rows against the same grammar (vision).
// Pass 3 (deterministic) validates arithmetic and reconciles against the bill's own
// totals. Every row is staged as a PROPOSAL via fn_stage_boq_rows_v2 (Rule 3);
// nothing auto-commits. DEV_AI_MODE keeps the whole pipeline runnable with no key.
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  annotateGrid, devSuggestKinds, validateAndReconcile, toStagePayload, normalizeUnit,
} from "../_shared/boq_core.mjs";
import { enrichBoqRows, extractBoqV2FromFile, type BoqV2Row, type StageRef } from "../_shared/ai-router.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let failReport: ((msg: string) => Promise<void>) | null = null;
  try {
    const { orgId, buildingTypeId, gridRows, fileBase64, mime, sourceMediaId, format, importId: preId, sheetLabel } = await req.json();
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    // Recipe stages give the AI its stage-suggestion vocabulary.
    let stages: StageRef[] = [];
    if (buildingTypeId) {
      const { data } = await supa.from("type_stages")
        .select("id,name,sequence").eq("building_type_id", buildingTypeId).order("sequence");
      stages = (data ?? []) as StageRef[];
    }

    const modelId = (Deno.env.get("DEV_AI_MODE") ?? "true") !== "false"
      ? "dev" : (Deno.env.get("AI_BOQ_MODEL") ?? "anthropic/claude-sonnet-5");

    // Live progress: when the client pre-created the import, report each phase
    // onto the row so the wizard can show REAL progress (and survive a dropped
    // connection). Best-effort — progress must never break the import.
    const report = (p: Record<string, unknown>) => {
      if (!preId) return Promise.resolve();
      return supa.rpc("fn_boq_import_progress", { p_import: preId, p_progress: p }).then(() => {}, () => {});
    };
    failReport = (msg) => report({ step: "error", message: msg });

    let rows: BoqV2Row[]; let fmt: string;
    if (Array.isArray(gridRows)) {
      // Spreadsheet lane: deterministic grammar first, AI enrichment on top.
      await report({ step: "decoding" });
      const annotated = annotateGrid(gridRows).rows as BoqV2Row[];
      // Multi-sheet workbooks: rows with no element of their own group under the
      // sheet's name, so per-sheet imports still bootstrap stages sensibly.
      if (typeof sheetLabel === "string" && sheetLabel.trim()) {
        for (const r of annotated) {
          if (!r.section_path || r.section_path.length === 0) r.section_path = [sheetLabel.trim()];
        }
      }
      devSuggestKinds(annotated);                       // baseline kinds (dev + fallback)
      await report({ step: "enriching", done: 0, total: 0 });
      rows = await enrichBoqRows(annotated, stages,     // no-op in DEV_AI_MODE
        (done, total) => { report({ step: "enriching", done, total }); });
      fmt = (format === "csv" ? "csv" : "xlsx");
    } else if (typeof fileBase64 === "string") {
      // PDF / photo lane: the model extracts against the same grammar.
      await report({ step: "reading_file" });
      const isImage = typeof mime === "string" && mime.startsWith("image/");
      rows = await extractBoqV2FromFile(fileBase64, mime ?? "application/pdf", stages);
      for (const r of rows) {                           // pass-3 backstops
        if (r.unit && !r.unit_normalized) r.unit_normalized = normalizeUnit(r.unit);
        r.flags = r.flags ?? [];
        if (r.row_kind === "item" && r.unit && !r.unit_normalized && !r.flags.includes("unknown_unit")) r.flags.push("unknown_unit");
        r.section_path = r.section_path ?? [];
      }
      devSuggestKinds(rows);
      fmt = (isImage ? (mime.split("/")[1] || "image") : "pdf").slice(0, 10);
    } else {
      return json({ error: "send gridRows (spreadsheet) or fileBase64 (pdf/photo)" }, 400);
    }

    // Pass 3: arithmetic checks + reconciliation vs the bill's own totals (§5).
    await report({ step: "validating" });
    const out = validateAndReconcile(rows);

    let importId = preId as string | undefined;
    if (!importId) {
      const { data, error: e1 } = await supa.rpc("fn_create_boq_import", {
        p_org: orgId, p_building_type: buildingTypeId ?? null,
        p_format: fmt, p_source_media: sourceMediaId ?? null,
      });
      if (e1) return json({ error: e1.message }, 400);
      importId = data;
    }

    await report({ step: "staging", rows: out.rows.length });
    const { data: staged, error: e2 } = await supa.rpc("fn_stage_boq_rows_v2", {
      p_import: importId,
      p_rows: toStagePayload(out.rows, modelId),
      p_document_totals: out.document_totals,
      p_reconciliation: out.reconciliation,
    });
    if (e2) return json({ error: e2.message }, 400);

    return json({
      importId, staged,
      reconciliation: out.reconciliation,
      unpriced_count: out.unpriced_count,
      priced_total: out.priced_total,
    });
  } catch (e) {
    await failReport?.(String(e));  // polled wizard sees the failure too
    return json({ error: String(e) }, 400);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...cors, "content-type": "application/json" },
  });
}
