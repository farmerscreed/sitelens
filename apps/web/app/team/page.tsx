import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";
import { TeamPanel } from "@/components/TeamPanel";

type Org = { org_id: string; org_name: string; role: string; is_active_org: boolean };
export type Member = {
  membership_id: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  is_self: boolean;
  created_at: string;
};

// Team / member administration. Admin-only: inviting and deactivating members is the
// deferred "account administration" work, gated to org admins by the DB functions and
// re-gated here so a non-admin who navigates directly gets a clear message, not a wall.
export default async function TeamPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: orgs } = await supabase.rpc("fn_my_orgs");
  const active = (orgs as Org[] | null)?.find((o) => o.is_active_org);

  if (active?.role !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Team" subtitle="Manage who can access this organisation." />
        <div className="card max-w-xl border-amber-500/20 bg-amber-500/[0.04]">
          <p className="text-sm text-amber-200">
            Only an <span className="font-semibold">admin</span> of{" "}
            {active?.org_name ?? "this organisation"} can manage members. Ask an admin to invite you or
            change your role.
          </p>
        </div>
      </div>
    );
  }

  const { data: members } = await supabase.rpc("fn_org_members");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Team"
        subtitle={`Invite people into ${active.org_name} and set what they can access.`}
        info={{
          what:
            "Invite teammates by email and give each a role. They receive an invite, then sign in on the login screen with that email — no password, just a 6-digit code. There is no self-signup: only people you invite here can get in. Deactivate anyone to revoke access instantly.",
          steps: [
            "Enter their email, name and role, then send the invite.",
            "They open the app's login page, enter the same email, and get a login code.",
            "Deactivate a member any time to cut off access; reactivate to restore it.",
          ],
        }}
      />
      <TeamPanel members={(members as Member[] | null) ?? []} orgName={active.org_name} />
    </div>
  );
}
