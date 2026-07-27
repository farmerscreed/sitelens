import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { CreateTypeForm } from "@/components/CreateTypeForm";

// Recipe library. Reads RLS-scoped to the active org; writes via SECURITY DEFINER fns.
export default async function RecipesPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const { data: types } = await supabase
    .from("building_types")
    .select("id,name,category,version,parent_version_id")
    .is("archived_at", null)
    .order("name");

  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">Recipe library</h1>
      <p className="text-sm text-neutral-500">
        A building type is a recipe: stages, material quantities (no price), and
        non-material costs. Digitise once per type, copy per building.
      </p>

      <ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
        {(types ?? []).map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <div>
              <Link className="font-medium underline" href={`/recipes/${t.id}`}>{t.name}</Link>
              <span className="ml-2 text-xs text-neutral-500">
                {t.category ?? "—"} · v{t.version}{t.parent_version_id ? " (revised)" : ""}
              </span>
            </div>
          </li>
        ))}
        {(types ?? []).length === 0 && <li className="py-3 text-neutral-500">No types yet.</li>}
      </ul>

      <CreateTypeForm orgId={orgId} />
    </main>
  );
}
