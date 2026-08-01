import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExpensesPanel } from "@/components/ExpensesPanel";
import { PageHeader } from "@/components/PageHeader";
import { activeProjectId } from "@/lib/activeProject";

export default async function ExpensesPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: projects } = await supabase.from("projects").select("id,name").is("archived_at", null).order("name");
  const projectId = activeProjectId(searchParams, projects ?? []);

  const [{ data: expenses }, { data: budgetLines }, { data: buildings }] = await Promise.all([
    supabase.from("expenses").select("id,amount,status,description,paid_to,budget_line_id,building_id,created_at")
      .eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("budget_lines").select("id,name,cost_code").eq("project_id", projectId),
    supabase.from("buildings").select("id,code").eq("project_id", projectId).is("archived_at", null).order("code"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Committed when recorded, spent only once approved. Amounts over ₦250k need Admin approval."
        info={{
          what: "Every spend on the project. An expense is 'committed' the moment it's recorded and 'spent' only once approved. Large amounts (over ₦250k) require an Admin to approve. Records are append-only — a mistake is voided with a reason, never edited away.",
          steps: [
            "Record an expense: amount, who it was paid to, and the budget line it belongs to.",
            "Small amounts post straight through; large ones wait for Admin approval.",
            "Void (with a reason) anything entered in error — the history stays intact.",
          ],
        }} />
      <ExpensesPanel projectId={projectId} expenses={expenses ?? []} budgetLines={budgetLines ?? []} buildings={buildings ?? []} />
    </div>
  );
}
