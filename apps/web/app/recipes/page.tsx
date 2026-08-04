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
    .select("id,name,category,version,parent_version_id,cover_key")
    .is("archived_at", null)
    .order("name");

  // Batch-sign the cover images (15-min URLs, org-scoped by storage RLS).
  const coverKeys = (types ?? []).map((t) => t.cover_key).filter((k): k is string => !!k);
  const covers: Record<string, string> = {};
  if (coverKeys.length > 0) {
    const { data: signed } = await supabase.storage.from("type-covers").createSignedUrls(coverKeys, 900);
    for (const s of signed ?? []) if (s.signedUrl && s.path) covers[s.path] = s.signedUrl;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recipe library"
        subtitle="A building type is a recipe: stages, material quantities (no price), and non-material costs. Digitise once per type, copy per building."
        info={{
          what: "A 'recipe' (building type) is the reusable design for a kind of building — its construction stages, the material quantity each stage needs, and non-material costs. Prices are never stored here; cost is worked out live from the price list.",
          steps: [
            "Create a type, then open it to add stages and the material quantities per stage.",
            "Or import a BOQ (from Excel/PDF) to fill the quantities quickly.",
            "Reuse the type across projects — stamp it onto buildings from the Board.",
          ],
        }} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(types ?? []).map((t) => {
          const cover = t.cover_key ? covers[t.cover_key] : undefined;
          return (
            <Link key={t.id} href={`/recipes/${t.id}`} className="card card-hover group overflow-hidden p-0">
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={cover} alt={t.name} className="h-36 w-full object-cover" />
              ) : (
                <div className="grid h-36 w-full place-items-center border-b border-white/[0.06] bg-white/[0.02] text-accent-300/60">
                  <IconLayers className="h-8 w-8" />
                </div>
              )}
              <div className="flex items-center gap-3 p-4">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-white">{t.name}</span>
                  <span className="block truncate text-xs text-[#8b95a7]">
                    {t.category ?? "—"} · v{t.version}{t.parent_version_id ? " · revised" : ""}
                  </span>
                </span>
                <IconChevron className="h-4 w-4 -rotate-90 text-[#5b6473] transition group-hover:text-accent-300" />
              </div>
            </Link>
          );
        })}
        {(types ?? []).length === 0 && (
          <p className="card text-sm text-[#8b95a7] sm:col-span-2 lg:col-span-3">No types yet — create your first recipe below.</p>
        )}
      </div>

      <CreateTypeForm orgId={orgId} />
    </div>
  );
}
