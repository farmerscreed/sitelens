// Edge Function: the question layer (AI-8, F-ASK). Embeds the question, retrieves the
// most relevant daily reports via pgvector (fn_match_reports), and answers over that
// context + live structured figures. It INFORMS judgment with numbers; it does not make
// decisions (F-ASK-2). DEV_AI_MODE stubs the model so this runs with no paid key.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { embed, answer } from "../_shared/ai-router.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { question, projectId } = await req.json();
    const supa = createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } },
    );

    // Retrieval: nearest reports by embedding, plus live reorder advice as structured context.
    const qvec = await embed(question);
    const { data: matches } = await supa.rpc("fn_match_reports", {
      p_project: projectId, p_embedding: qvec, p_k: 5,
    });
    const { data: reorder } = await supa.rpc("fn_reorder_advice", { p_project: projectId });

    const context = JSON.stringify({ related_reports: matches ?? [], reorder_advice: reorder ?? [] });
    const text = await answer(question, context);
    return json({ answer: text, used_reports: (matches ?? []).length });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...cors, "content-type": "application/json" } });
}
