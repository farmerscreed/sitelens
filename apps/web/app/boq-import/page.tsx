import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { BoqImportWizard } from "@/components/BoqImportWizard";
import { PageHeader } from "@/components/PageHeader";

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
    <div className="space-y-6">
      <PageHeader
        title="Import a BOQ"
        subtitle="Excel/CSV parses directly (no AI); PDF is read by a vision model. Every extracted row is a proposal you confirm before it joins a type's recipe." />
      <BoqImportWizard orgId={orgId} types={types ?? []} />
    </div>
  );
}
