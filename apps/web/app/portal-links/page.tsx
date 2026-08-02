import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalLinksPanel } from "@/components/PortalLinksPanel";
import { PageHeader } from "@/components/PageHeader";
import { activeProjectId } from "@/lib/activeProject";

export default async function PortalLinksPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: projects } = await supabase.from("projects").select("id,name").is("archived_at", null).order("name");
  const projectId = activeProjectId(searchParams, projects ?? []);

  const [{ data: links }, { data: accesses }, { data: buildings }] = await Promise.all([
    supabase.from("portal_links")
      .select("id,recipient_name,recipient_phone,recipient_email,link_type,building_id,expires_at,revoked_at,created_at")
      .eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("portal_access_log").select("link_id,accessed_at,pin_success").order("accessed_at", { ascending: false }),
    supabase.from("buildings").select("id,code").eq("project_id", projectId).is("archived_at", null).order("code"),
  ]);

  const lastOpened = new Map<string, string>();
  for (const a of accesses ?? []) if (a.pin_success && !lastOpened.has(a.link_id)) lastOpened.set(a.link_id, a.accessed_at);

  return (
    <div className="space-y-6">
      <PageHeader title="Client portal links" subtitle="Share a read-only, PIN-protected progress view with each client."
        info={{
          what: "Give a client a safe window into their project — progress and photos only, no prices, suppliers or workers. They open a link and enter a PIN; no account needed. You can revoke access any time and every open is logged.",
          steps: [
            "Create a link for the client (name + phone); a one-time PIN is shown once — share it with them.",
            "They open the link, enter the PIN, and see read-only progress.",
            "Revoke a link whenever you like; check 'last opened' to see engagement.",
          ],
        }} />
      <PortalLinksPanel
        projectId={projectId}
        links={(links ?? []).map((l) => ({ ...l, last_opened: lastOpened.get(l.id) ?? null }))}
        buildings={buildings ?? []}
      />
    </div>
  );
}
