import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { CreatePlanForm } from "@/components/CreatePlanForm";

// Feasibility planner (§7). Scenarios are saved inputs; results are computed live.
export default async function PlannerPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromToken(sessionRes.session?.access_token);

  const { data: plans } = await supabase
    .from("plans")
    .select("id,name,mode,created_at")
    .order("created_at", { ascending: false });

  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">Feasibility planner</h1>
      <p className="text-sm text-neutral-500">
        &ldquo;What cash do I need, and when?&rdquo; (funding-required) or &ldquo;how far
        does my cash go?&rdquo; (max-delivery). Results re-compute at current prices, so
        a price change updates every saved scenario.
      </p>

      <ul className="divide-y divide-neutral-100 dark:divide-neutral-900">
        {(plans ?? []).map((p) => (
          <li key={p.id} className="flex items-center justify-between py-2">
            <Link className="font-medium underline" href={`/planner/${p.id}`}>{p.name}</Link>
            <span className="text-xs text-neutral-500">{p.mode.replace("_", "-")}</span>
          </li>
        ))}
        {(plans ?? []).length === 0 && <li className="py-3 text-neutral-500">No scenarios yet.</li>}
      </ul>

      <CreatePlanForm orgId={orgId} />
    </main>
  );
}
