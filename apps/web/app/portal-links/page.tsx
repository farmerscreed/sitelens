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

  const { data: links } = await supabase
    .from("portal_links")
    .select("id,recipient_name,recipient_phone,show_line_items,expires_at,revoked_at,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  const { data: accesses } = await supabase
    .from("portal_access_log")
    .select("link_id,accessed_at,pin_success")
    .order("accessed_at", { ascending: false });

  const lastOpened = new Map<string, string>();
  for (const a of accesses ?? []) if (a.pin_success && !lastOpened.has(a.link_id)) lastOpened.set(a.link_id, a.accessed_at);

  return (
    <div className="space-y-6">
      <PageHeader title="Client portal links" subtitle="Share a read-only, PIN-protected progress view with each client." />
      <PortalLinksPanel
        projectId={projectId}
        links={(links ?? []).map((l) => ({ ...l, last_opened: lastOpened.get(l.id) ?? null }))}
      />
    </div>
  );
}
