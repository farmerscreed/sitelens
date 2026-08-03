// Edge Function: invite a person into the caller's org and grant them a role.
//
// The account-creation half needs the service role (GoTrue admin API — SQL can't mint
// an auth user), so it lives here. The AUTHORIZATION half stays in the database:
// fn_add_member runs under the CALLER's identity (auth.uid()/current_org_id from their
// JWT) and requires them to be an active admin. So even though this function holds the
// service-role key, it cannot grant membership into an org the caller doesn't admin —
// the DB re-checks. We also gate up-front (fn_require_org_admin) so a non-admin caller
// never causes an orphan auth user to be created.
//
// Flow: authorize caller → resolve-or-create the auth user for the email → wire up
// app_users + membership (fn_add_member) → the invitee then signs in at /login with
// their email (signInWithOtp finds them because they now exist).
//
// Deno runtime; not run on this dev box (see storage-signed-url). Code-complete for
// `supabase functions serve`.
import { createClient } from "jsr:@supabase/supabase-js@2";

const ROLES = ["admin", "pm", "engineer", "client"] as const;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const role = String(body.role ?? "");

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: "a valid email is required" }, 400);
    }
    if (!ROLES.includes(role as (typeof ROLES)[number])) {
      return json({ error: `role must be one of ${ROLES.join(", ")}` }, 400);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    // Caller-bound client: every RPC below runs as the caller, so the DB authorises.
    const asUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes } = await asUser.auth.getUser();
    if (!userRes.user) return json({ error: "unauthorized" }, 401);

    // Authorize BEFORE creating any auth user (avoids orphans on a rejected invite).
    const { error: guardErr } = await asUser.rpc("fn_require_org_admin");
    if (guardErr) return json({ error: "only an admin can invite members" }, 403);

    // Resolve an existing GoTrue user for this email, else create one. email_confirm so
    // the invitee can immediately request an OTP without a separate confirmation step.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    let uid: string | null = null;
    let created = false;
    const { data: existing, error: lookupErr } = await asUser.rpc("fn_auth_uid_by_email", { p_email: email });
    if (lookupErr) return json({ error: lookupErr.message }, 400);
    if (existing) {
      uid = existing as string;
    } else {
      const { data: newUser, error: cErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (cErr || !newUser?.user) return json({ error: cErr?.message ?? "could not create user" }, 400);
      uid = newUser.user.id;
      created = true;
    }

    // Grant membership (authorisation re-checked here, under the caller's identity).
    const { data: membershipId, error: addErr } = await asUser.rpc("fn_add_member", {
      p_user: uid,
      p_email: email,
      p_name: name,
      p_role: role,
    });
    if (addErr) {
      const status = /admin/i.test(addErr.message) ? 403 : 400;
      return json({ error: addErr.message }, status);
    }

    return json({ ok: true, membership_id: membershipId, user_id: uid, created });
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
