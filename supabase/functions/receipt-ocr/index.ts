// Edge Function: receipt/waybill OCR (AI-2). A vision model extracts {amount,date,payee}
// and we cross-check the TYPED amount against the extracted one, then record an
// ai_inferences PROPOSAL (Rule 3 — a human confirms; the correction becomes a label).
// DEV_AI_MODE returns canned fields so this runs with no paid key.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractReceipt } from "../_shared/ai-router.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { imageBase64, orgId, projectId, typedAmount } = await req.json();
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    const r = await extractReceipt(imageBase64);
    const mismatch = typedAmount != null && Math.abs(Number(typedAmount) - r.amount) > 0.01;

    const { data: inferenceId, error } = await supa.rpc("fn_record_inference", {
      p_org: orgId, p_project: projectId ?? null, p_subject_type: "expense",
      p_output: { ...r, typed_amount: typedAmount, amount_mismatch: mismatch },
      p_confidence: r.confidence, p_cost_estimate: 0.0004,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ inferenceId, extracted: r, amount_mismatch: mismatch });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });
}
