import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PortalLinksPanel } from "@/components/PortalLinksPanel";

export default async function PortalLinksPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: projects } = await supabase.from("projects").select("id,name").order("name");
  const projectId = searchParams.project ?? projects?.[0]?.id ?? "";

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
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Client portal links</h1>
        <form>
          <select name="project" defaultValue={projectId}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()}>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </form>
      </header>
      <PortalLinksPanel
        projectId={projectId}
        links={(links ?? []).map((l) => ({ ...l, last_opened: lastOpened.get(l.id) ?? null }))}
      />
    </main>
  );
}
