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
        subtitle="Whole workbooks welcome: every sheet is classified, duplicates are caught, and each bill sheet becomes a reviewable import. Every extracted row is a proposal you confirm before it joins a type's recipe."
        info={{
          what: "Turn a bill of quantities into a recipe fast. A multi-sheet workbook is read whole — bill sheets import one by one, rates/schedule/summary sheets are recognised for set-up and cross-checks, and duplicated sheets are pre-excluded so nothing double-counts. PDFs and photos are read by a vision model. Every row is a proposal — you review and confirm before anything is saved.",
          steps: [
            "Choose the building type the BOQ belongs to.",
            "Upload the file (Excel/CSV workbook, PDF or photo).",
            "Confirm the workbook map (which sheet is which), then extract.",
            "Review each import, fix anything off, then confirm to add it to the recipe.",
          ],
        }} />
      <BoqImportWizard orgId={orgId} types={types ?? []} />
    </div>
  );
}
