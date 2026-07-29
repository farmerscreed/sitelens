import { cookies } from "next/headers";

// Sticky "active project" across the console. Priority: explicit ?project= in the URL,
// then the sl_project cookie (set by the top-bar switcher), then the first accessible
// project. The cookie value is only honoured if it's actually in the caller's accessible
// list (RLS already scopes that list), so a stale cookie can never surface another
// project's data — it just falls back to the first one.
export const PROJECT_COOKIE = "sl_project";

export function activeProjectId(
  searchParams: { project?: string },
  projects: { id: string }[],
): string {
  const inList = (id?: string) => (id && projects.some((p) => p.id === id) ? id : undefined);
  const fromCookie = cookies().get(PROJECT_COOKIE)?.value;
  return inList(searchParams.project) ?? inList(fromCookie) ?? projects[0]?.id ?? "";
}
