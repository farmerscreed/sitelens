import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ExpensesPanel } from "@/components/ExpensesPanel";

export default async function ExpensesPage({ searchParams }: { searchParams: { project?: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: projects } = await supabase.from("projects").select("id,name").order("name");
  const projectId = searchParams.project ?? projects?.[0]?.id ?? "";

  const [{ data: expenses }, { data: budgetLines }] = await Promise.all([
    supabase.from("expenses").select("id,amount,status,description,paid_to,budget_line_id,created_at")
      .eq("project_id", projectId).order("created_at", { ascending: false }),
    supabase.from("budget_lines").select("id,name,cost_code").eq("project_id", projectId),
  ]);

  return (
    <main className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Expenses</h1>
        <form>
          <select name="project" defaultValue={projectId}
            className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
            onChange={(e) => (e.target.form as HTMLFormElement).requestSubmit()}>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </form>
      </header>
      <p className="text-sm text-neutral-500">
        An expense is <strong>committed</strong> when recorded and <strong>spent</strong>
        only once approved. Amounts over ₦250k need Admin approval.
      </p>
      <ExpensesPanel projectId={projectId} expenses={expenses ?? []} budgetLines={budgetLines ?? []} />
    </main>
  );
}
