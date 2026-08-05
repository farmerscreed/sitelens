import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { BoqImportWizard } from "@/components/BoqImportWizard";
import { PageHeader } from "@/components/PageHeader";
import { DeleteImportButton } from "@/components/DeleteControls";
import { IconChevron } from "@/components/icons";

export default async function BoqImportPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const [{ data: types }, { data: staged }] = await Promise.all([
    supabase.from("building_types")
      .select("id,name")
      .is("archived_at", null)
      .order("name"),
    // Staged-but-unconfirmed imports: the "continue where you left off" list —
    // multi-bill workbooks leave several imports awaiting review, and users who
    // navigate away must always find their way back.
    supabase.from("boq_imports")
      .select("id,format,status,created_at,building_type_id")
      .eq("status", "review")
      .order("created_at", { ascending: true })
      .limit(20),
  ]);
  const typeName = (id: string | null) => (types ?? []).find((t) => t.id === id)?.name ?? "—";

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

      {(staged ?? []).length > 0 && (
        <section className="card border-accent-500/25 bg-accent-500/[0.04]">
          <h2 className="text-sm font-semibold text-white">
            Continue where you left off — {(staged ?? []).length} bill{(staged ?? []).length === 1 ? "" : "s"} awaiting review
          </h2>
          <p className="mt-1 text-xs text-[#8b95a7]">
            These are extracted and staged, but not yet confirmed into their recipe. Review them in order —
            each confirm hands you the next.
          </p>
          <ul className="mt-3 space-y-1.5">
            {(staged ?? []).map((s, i) => (
              <li key={s.id} className="flex items-center gap-2">
                <Link href={`/boq-import/${s.id}`}
                  className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5 text-sm transition hover:border-accent-500/40">
                  <span className="text-xs text-[#5b6473]">{i + 1}.</span>
                  <span className="text-white">{typeName(s.building_type_id)}</span>
                  <span className="badge badge-muted">{(s.format ?? "").toUpperCase()}</span>
                  <span className="text-xs text-[#5b6473]">{new Date(s.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}</span>
                  <IconChevron className="ml-auto h-4 w-4 -rotate-90 text-[#5b6473] transition group-hover:text-accent-300" />
                </Link>
                <DeleteImportButton importId={s.id} small />
              </li>
            ))}
          </ul>
        </section>
      )}

      <BoqImportWizard orgId={orgId} types={types ?? []} />
    </div>
  );
}
