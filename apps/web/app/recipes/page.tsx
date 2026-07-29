import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { CreateTypeForm } from "@/components/CreateTypeForm";
import { PageHeader } from "@/components/PageHeader";
import { IconLayers, IconChevron } from "@/components/icons";

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
    <div className="space-y-6">
      <PageHeader
        title="Recipe library"
        subtitle="A building type is a recipe: stages, material quantities (no price), and non-material costs. Digitise once per type, copy per building." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(types ?? []).map((t) => (
          <Link key={t.id} href={`/recipes/${t.id}`} className="card card-hover group flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-accent-300">
              <IconLayers className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-white">{t.name}</span>
              <span className="block truncate text-xs text-[#8b95a7]">
                {t.category ?? "—"} · v{t.version}{t.parent_version_id ? " · revised" : ""}
              </span>
            </span>
            <IconChevron className="h-4 w-4 -rotate-90 text-[#5b6473] transition group-hover:text-accent-300" />
          </Link>
        ))}
        {(types ?? []).length === 0 && (
          <p className="card text-sm text-[#8b95a7] sm:col-span-2 lg:col-span-3">No types yet — create your first recipe below.</p>
        )}
      </div>

      <CreateTypeForm orgId={orgId} />
    </div>
  );
}
