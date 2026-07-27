import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlanEditor } from "@/components/PlanEditor";

export default async function PlanDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: plan } = await supabase
    .from("plans")
    .select("id,name,mode,assumptions,inflows,available_cash")
    .eq("id", params.id)
    .single();
  if (!plan) redirect("/planner");

  const [{ data: lines }, { data: types }, { data: stages }] = await Promise.all([
    supabase.from("plan_lines").select("id,building_type_id,quantity,target_stage_id,batch_hint").eq("plan_id", plan.id),
    supabase.from("building_types").select("id,name").is("archived_at", null).order("name"),
    supabase.from("type_stages").select("id,building_type_id,name,sequence").order("sequence"),
  ]);

  // Compute live (server-side): the engine reads current prices.
  const rpc = plan.mode === "max_delivery" ? "fn_max_delivery" : "fn_compute_feasibility";
  const { data: result } = await supabase.rpc(rpc, { p_plan: plan.id });

  return (
    <PlanEditor
      plan={plan}
      lines={lines ?? []}
      types={types ?? []}
      stages={stages ?? []}
      result={result ?? null}
    />
  );
}
