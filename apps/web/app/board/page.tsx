import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { Board } from "@/components/Board";
import { StampBuildings } from "@/components/StampBuildings";
import { PageHeader } from "@/components/PageHeader";
import { ProjectPicker } from "@/components/ProjectPicker";

// The board (F-BOARD-1/2): every building as a card, in columns by stage.
export default async function BoardPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const { data: projects } = await supabase.from("projects").select("id,name").order("name");
  const projectId = searchParams.project ?? projects?.[0]?.id ?? "";

  const [{ data: rows }, { data: types }, { data: phases }, { data: batches }] = await Promise.all([
    supabase.from("board_view").select("*").eq("project_id", projectId).order("code"),
    supabase.from("building_types").select("id,name").is("archived_at", null).order("name"),
    supabase.from("phases").select("id,name").eq("project_id", projectId).order("sequence"),
    supabase.from("batches").select("id,name,status").eq("project_id", projectId).order("sequence"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Board" subtitle="Every building as a card, tracked by construction stage.">
        <ProjectPicker projects={projects ?? []} value={projectId} />
      </PageHeader>

      <StampBuildings
        projectId={projectId}
        types={types ?? []}
        phases={phases ?? []}
        batches={batches ?? []}
      />

      <Board rows={rows ?? []} batches={batches ?? []} types={types ?? []} />
    </div>
  );
}
