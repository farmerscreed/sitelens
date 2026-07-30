import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BoqReview } from "@/components/BoqReview";

export default async function BoqReviewPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: imp } = await supabase
    .from("boq_imports")
    .select("id,building_type_id,format,status,reconciliation,document_totals,priced_total,unpriced_count")
    .eq("id", params.id)
    .single();
  if (!imp) redirect("/boq-import");

  const [{ data: rows }, { data: materials }, { data: stages }] = await Promise.all([
    supabase.from("boq_import_rows")
      .select("id,raw_text,resolved_text,parsed_qty,parsed_unit,unit_normalized,parsed_rate,amount,mapped_material_id,confidence,status,row_kind,boq_ref,section_path,is_priced,is_provisional,suggested_stage_id,suggested_kind,mix_ratio,material_guess,flags")
      .eq("import_id", params.id),
    supabase.from("materials_catalog").select("id,name,unit").order("name"),
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", imp.building_type_id).order("sequence"),
  ]);

  return (
    <BoqReview
      importId={imp.id}
      format={imp.format ?? ""}
      status={imp.status ?? ""}
      reconciliation={imp.reconciliation ?? null}
      pricedTotal={imp.priced_total != null ? Number(imp.priced_total) : null}
      unpricedCount={imp.unpriced_count ?? null}
      rows={rows ?? []}
      materials={materials ?? []}
      stages={stages ?? []}
    />
  );
}
