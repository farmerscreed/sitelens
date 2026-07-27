import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RecipeEditor } from "@/components/RecipeEditor";

export default async function RecipeDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const typeId = params.id;
  const [{ data: type }, { data: stages }, { data: items }, { data: costs }, { data: materials }, { data: cost }] =
    await Promise.all([
      supabase.from("building_types").select("id,name,category,version").eq("id", typeId).single(),
      supabase.from("type_stages").select("id,name,sequence").eq("building_type_id", typeId).order("sequence"),
      supabase.from("type_boq_items").select("id,stage_id,material_id,quantity,unit").eq("building_type_id", typeId),
      supabase.from("type_stage_costs").select("id,stage_id,category,amount").eq("building_type_id", typeId),
      supabase.from("materials_catalog").select("id,name,unit").order("name"),
      supabase.rpc("fn_type_cost", { p_type: typeId }).single(),
    ]);

  if (!type) redirect("/recipes");

  return (
    <RecipeEditor
      type={type}
      stages={stages ?? []}
      items={items ?? []}
      costs={costs ?? []}
      materials={materials ?? []}
      cost={cost ?? { materials_cost: 0, nonmaterial_cost: 0, total_cost: 0 }}
    />
  );
}
