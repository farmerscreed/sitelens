// Edge Function: PDF BOQ extraction (F-BOQ-2 / AI-7). A vision model (via the
// OpenRouter router) extracts rows; every row is staged as a PROPOSAL a human
// confirms — never auto-committed (Rule 3). DEV_AI_MODE returns canned rows so this
// runs with no paid key.
// Deno runtime; code-complete (edge-runtime not managed on this dev box).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractBoqFromPdf } from "../_shared/ai-router.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { fileBase64, orgId, buildingTypeId, sourceMediaId } = await req.json();
    const authHeader = req.headers.get("Authorization") ?? "";
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const rows = await extractBoqFromPdf(fileBase64);

    const { data: importId, error: e1 } = await supa.rpc("fn_create_boq_import", {
      p_org: orgId, p_building_type: buildingTypeId ?? null,
      p_format: "pdf", p_source_media: sourceMediaId ?? null,
    });
    if (e1) return json({ error: e1.message }, 400);

    const { data: staged, error: e2 } = await supa.rpc("fn_stage_boq_rows", {
      p_import: importId, p_rows: rows,
    });
    if (e2) return json({ error: e2.message }, 400);

    return json({ importId, staged, proposals: rows.length });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status, headers: { ...cors, "content-type": "application/json" },
  });
}
