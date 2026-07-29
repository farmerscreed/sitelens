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
        subtitle="Excel/CSV parses directly (no AI); PDF is read by a vision model. Every extracted row is a proposal you confirm before it joins a type's recipe."
        info={{
          what: "Turn a bill of quantities into a recipe fast. Spreadsheets are parsed directly; PDFs are read by a vision model. Every row it extracts is a proposal — you review and confirm before anything is saved to a type.",
          steps: [
            "Choose the building type the BOQ belongs to.",
            "Upload the file (Excel/CSV or PDF).",
            "Review the extracted rows, fix anything off, then confirm to add them to the recipe.",
          ],
        }} />
      <BoqImportWizard orgId={orgId} types={types ?? []} />
    </div>
  );
}
