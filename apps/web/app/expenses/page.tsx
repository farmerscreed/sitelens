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

  const [{ data: expenses }, { data: budgetLines }] = await Promise.all([
    supabase.from("expenses").select("id,amount,status,description,paid_to,budget_line_id,created_at")
      .eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("budget_lines").select("id,name,cost_code").eq("project_id", projectId),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        subtitle="Committed when recorded, spent only once approved. Amounts over ₦250k need Admin approval." />
      <ExpensesPanel projectId={projectId} expenses={expenses ?? []} budgetLines={budgetLines ?? []} />
    </div>
  );
}
