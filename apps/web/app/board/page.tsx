import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { Board } from "@/components/Board";
import { StampBuildings } from "@/components/StampBuildings";

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
    <main className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Board</h1>
        <form>
          <select name="project" defaultValue={projectId}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            onChange={(e) => { (e.target.form as HTMLFormElement).requestSubmit(); }}>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </form>
      </header>

      <StampBuildings
        projectId={projectId}
        types={types ?? []}
        phases={phases ?? []}
        batches={batches ?? []}
      />

      <Board rows={rows ?? []} batches={batches ?? []} types={types ?? []} />
    </main>
  );
}
