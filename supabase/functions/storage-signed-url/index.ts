// Edge Function: issue a 15-minute signed URL for a BOQ source object, AFTER a
// permission check (PRD §5.3 / SEC-10). The caller must be an active member of the
// org that owns the object (object key is `<org_id>/<uuid>`).
//
// Deno runtime. Not run on this dev box (edge-runtime container isn't managed here);
// code-complete for `supabase functions serve` on a normal environment.
import { createClient } from "jsr:@supabase/supabase-js@2";

const TTL = 15 * 60;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { key } = await req.json(); // "<org_id>/<uuid>.<ext>"
    const authHeader = req.headers.get("Authorization") ?? "";

    // Client bound to the caller's JWT — RLS + the org path check gate access.
    const asUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await asUser.auth.getUser();
    if (!userRes.user) return json({ error: "unauthorized" }, 401);

    // Permission check: the object's org (first path segment) must be one the caller
    // is an active member of. fn_my_orgs is SECURITY DEFINER and scoped to auth.uid().
    const orgId = String(key).split("/")[0];
    const { data: orgs } = await asUser.rpc("fn_my_orgs");
    if (!orgs?.some((o: { org_id: string }) => o.org_id === orgId)) {
      return json({ error: "forbidden" }, 403);
    }

    // Sign with the service role (bypasses storage RLS, but we've already authorized).
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await admin.storage.from("boq-sources").createSignedUrl(key, TTL);
    if (error) return json({ error: error.message }, 400);
    return json({ url: data.signedUrl, expiresIn: TTL });
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
