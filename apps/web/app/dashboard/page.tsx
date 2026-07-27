import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrgSwitcher } from "@/components/OrgSwitcher";

// Decode a JWT payload without verifying (display only). The server already trusts
// the session; we just want to SHOW the active_org_id claim the A0 hook injected.
function decodeClaims(jwt: string): Record<string, unknown> {
  try {
    const [, payload] = jwt.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

export default async function Dashboard() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: sessionRes } = await supabase.auth.getSession();
  const claims = sessionRes.session ? decodeClaims(sessionRes.session.access_token) : {};

  // Orgs this user can switch between (SECURITY DEFINER; bypasses org-scoped RLS).
  const { data: orgs } = await supabase.rpc("fn_my_orgs");

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">SiteLens — Command Console</h1>
          <p className="text-sm text-neutral-500">Signed in as {userRes.user.phone}</p>
        </div>
        <OrgSwitcher orgs={orgs ?? []} />
      </header>

      <nav className="flex gap-4 text-sm">
        <a className="underline" href="/board">Board</a>
        <a className="underline" href="/planner">Planner</a>
        <a className="underline" href="/materials">Materials</a>
        <a className="underline" href="/expenses">Expenses</a>
        <a className="underline" href="/prices">Price list</a>
        <a className="underline" href="/recipes">Recipes</a>
        <a className="underline" href="/boq-import">BOQ import</a>
      </nav>

      <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-2 text-sm font-medium text-neutral-500">Active JWT claims (A0 hook)</h2>
        <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-neutral-500">active_org_id</dt>
          <dd className="font-mono">{String(claims.active_org_id ?? "—")}</dd>
          <dt className="text-neutral-500">user_role</dt>
          <dd className="font-mono">{String(claims.user_role ?? "—")}</dd>
          <dt className="text-neutral-500">membership_id</dt>
          <dd className="font-mono">{String(claims.membership_id ?? "—")}</dd>
        </dl>
        <p className="mt-3 text-xs text-neutral-500">
          RLS gates every query on <code>active_org_id</code>. If this is populated, the
          access-token hook is working and the console sees only this org&apos;s data.
        </p>
      </section>
    </main>
  );
}
