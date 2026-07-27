import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { BoqImportWizard } from "@/components/BoqImportWizard";

export default async function BoqImportPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const { data: types } = await supabase
    .from("building_types")
    .select("id,name")
    .is("archived_at", null)
    .order("name");

  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">Import a BOQ</h1>
      <p className="text-sm text-neutral-500">
        Excel/CSV parses directly (no AI); PDF is read by a vision model. Either way,
        every extracted row is a <strong>proposal</strong> you confirm before it becomes
        part of a type&apos;s recipe.
      </p>
      <BoqImportWizard orgId={orgId} types={types ?? []} />
    </main>
  );
}
