import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { activeOrgFromToken } from "@/lib/activeOrg";
import { CreatePlanForm } from "@/components/CreatePlanForm";
import { PageHeader } from "@/components/PageHeader";
import { IconCalendar, IconChevron } from "@/components/icons";

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
    <div className="space-y-6">
      <PageHeader
        title="Feasibility planner"
        subtitle="&ldquo;What cash do I need, and when?&rdquo; or &ldquo;how far does my cash go?&rdquo; Results re-compute at current prices, so a price change updates every saved scenario."
        info={{
          what: "Model a project before (or while) you build it. A scenario stores your inputs; the numbers are always recomputed at current prices, so a price change updates every saved scenario automatically.",
          steps: [
            "Create a scenario and choose a mode: funding-required (how much cash, and when) or max-delivery (how far a fixed budget goes).",
            "Add the building types and counts you're planning.",
            "Open it any time to see the live cash/'schedule result at today's prices.",
          ],
        }} />

      <div className="grid gap-3 sm:grid-cols-2">
        {(plans ?? []).map((p) => (
          <Link key={p.id} href={`/planner/${p.id}`} className="card card-hover group flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-accent-300">
              <IconCalendar className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-white">{p.name}</span>
              <span className="badge badge-muted mt-1">{p.mode.replace("_", "-")}</span>
            </span>
            <IconChevron className="h-4 w-4 -rotate-90 text-[#5b6473] transition group-hover:text-accent-300" />
          </Link>
        ))}
        {(plans ?? []).length === 0 && (
          <p className="card text-sm text-[#8b95a7] sm:col-span-2">No scenarios yet — create one below.</p>
        )}
      </div>

      <CreatePlanForm orgId={orgId} />
    </div>
  );
}
