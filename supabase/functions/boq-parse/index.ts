// Edge Function: parse an Excel/CSV BOQ server-side with SheetJS — NO AI (F-BOQ-1).
// Two modes:
//   1) inspect: {fileBase64} → {headers, sampleRows, headerSignature}
//   2) stage:   {fileBase64, orgId, buildingTypeId, mapping} → creates an import and
//      stages the rows as proposals via fn_stage_boq_rows, remembers the mapping.
// Deno runtime; code-complete (edge-runtime container not managed on this dev box).
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function headerSignature(headers: string[]): string {
  return headers.map((h) => String(h).trim().toLowerCase()).join("|");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json();
    const bytes = Uint8Array.from(atob(body.fileBase64), (c) => c.charCodeAt(0));
    const wb = XLSX.read(bytes, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
    if (grid.length === 0) return json({ error: "empty sheet" }, 400);

    const headers = (grid[0] as unknown[]).map((h) => String(h ?? ""));
    const dataRows = grid.slice(1);

    // Mode 1 — inspect: hand the mapping screen the headers + a preview.
    if (!body.mapping) {
      return json({
        headers,
        headerSignature: headerSignature(headers),
        sampleRows: dataRows.slice(0, 5),
      });
    }

    // Mode 2 — stage. mapping = {item, quantity, unit?, rate?} column indexes.
    const m = body.mapping as { item: number; quantity: number; unit?: number; rate?: number };
    const rows = dataRows
      .filter((r) => String(r[m.item] ?? "").trim() !== "")
      .map((r) => ({
        raw_text: String(r[m.item] ?? "").trim(),
        parsed_qty: r[m.quantity] != null ? String(r[m.quantity]) : "",
        parsed_unit: m.unit != null ? String(r[m.unit] ?? "") : "",
        parsed_rate: m.rate != null && r[m.rate] != null ? String(r[m.rate]) : "",
      }));

    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: importId, error: e1 } = await supa.rpc("fn_create_boq_import", {
      p_org: body.orgId, p_building_type: body.buildingTypeId ?? null,
      p_format: "xlsx", p_source_media: body.sourceMediaId ?? null,
    });
    if (e1) return json({ error: e1.message }, 400);

    const { data: staged, error: e2 } = await supa.rpc("fn_stage_boq_rows", {
      p_import: importId, p_rows: rows,
    });
    if (e2) return json({ error: e2.message }, 400);

    await supa.rpc("fn_remember_column_mapping", {
      p_org: body.orgId, p_signature: headerSignature(headers), p_mapping: m,
    });

    return json({ importId, staged });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...cors, "content-type": "application/json" },
  });
}
