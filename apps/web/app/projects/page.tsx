import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { PageHeader } from "@/components/PageHeader";
import { ProjectsManager } from "@/components/ProjectsManager";
import { PROJECT_COOKIE } from "@/lib/activeProject";

// Projects module. The list is RLS-scoped (you only see projects in your org that you
// have access to). Create/rename/archive go through SECURITY DEFINER fns (admin/PM only).
export default async function ProjectsPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: projects } = await supabase
    .from("projects")
    .select("id,name,location_text,status,total_budget,start_date,target_end_date,archived_at,created_at")
    .order("created_at", { ascending: true });

  const activeId = cookies().get(PROJECT_COOKIE)?.value
    ?? (projects ?? []).find((p) => !p.archived_at)?.id
    ?? "";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        subtitle="Each project is fully isolated — buildings, stock, expenses, reports and portal links never cross between them. Pick the active project from the top-bar switcher." />
      <ProjectsManager projects={projects ?? []} activeId={activeId} />
    </div>
  );
}
