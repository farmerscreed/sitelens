import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { AssembliesManager } from "@/components/AssembliesManager";
import { PageHeader } from "@/components/PageHeader";

// Assembly library: org-level mixes/build-ups (concrete 1:2:4, blockwork, formwork…)
// that turn a composite BOQ line into raw materials + labour. Reads are RLS-scoped
// SELECTs; every write goes through fn_upsert_assembly / fn_set_material_conversion
// (SECURITY DEFINER — Rule 1). Derived ratios are shown for human confirmation
// before save (Rule 3).
export default async function AssembliesPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const [{ data: assemblies }, { data: components }, { data: materials }, { data: conversions }] =
    await Promise.all([
      supabase.from("assemblies")
        .select("id,name,unit,kind,ratio,dry_factor,labour_rate,plant_rate,alternative_group")
        .order("name"),
      supabase.from("assembly_components")
        .select("assembly_id,material_id,qty_per_unit,unit,waste_factor,component_kind,reuse_count"),
      supabase.from("materials_catalog").select("id,name,unit").order("name"),
      supabase.from("material_conversions").select("id,material_id,from_unit,to_unit,factor"),
    ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assemblies"
        subtitle="Reusable recipes for composite work — a concrete mix, a m² of blockwork — so a single BOQ line explodes into real materials and labour."
        info={{
          what: "An assembly describes what one unit of composite work consumes: e.g. 1 m³ of 1:2:4 concrete = cement + sand + granite (dry-volume factored) + labour. Work items that point at an assembly get a live cost from today's price list — the QS rate stays reference only.",
          steps: [
            "For concrete, type the ratio (e.g. 1:2:4), pick the cement/sand/granite materials and derive the quantities.",
            "Check the derived rows — you can edit every figure before saving.",
            "Add unit conversions (sand m³→ton etc.) so quantities bridge into stock units.",
          ],
        }} />
      <AssembliesManager
        orgId={orgId}
        materials={materials ?? []}
        assemblies={(assemblies ?? []).map((a) => ({
          ...a,
          components: (components ?? []).filter((c) => c.assembly_id === a.id),
        }))}
        conversions={conversions ?? []}
      />
    </div>
  );
}
