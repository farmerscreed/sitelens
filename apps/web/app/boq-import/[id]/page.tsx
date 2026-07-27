import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BoqReview } from "@/components/BoqReview";

export default async function BoqReviewPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: imp } = await supabase
    .from("boq_imports")
    .select("id,building_type_id,format,status")
    .eq("id", params.id)
    .single();
  if (!imp) redirect("/boq-import");

  const [{ data: rows }, { data: materials }, { data: stages }] = await Promise.all([
    supabase.from("boq_import_rows")
      .select("id,raw_text,parsed_qty,parsed_unit,mapped_material_id,confidence,status")
      .eq("import_id", params.id),
    supabase.from("materials_catalog").select("id,name,unit").order("name"),
    supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", imp.building_type_id).order("sequence"),
  ]);

  return (
    <BoqReview
      importId={imp.id}
      format={imp.format ?? ""}
      status={imp.status ?? ""}
      rows={rows ?? []}
      materials={materials ?? []}
      stages={stages ?? []}
    />
  );
}
