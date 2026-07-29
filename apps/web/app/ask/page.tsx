import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AskBox } from "@/components/AskBox";
import { PageHeader } from "@/components/PageHeader";

export default async function AskPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: projects } = await supabase.from("projects").select("id,name").order("name");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ask"
        subtitle="Plain-language questions answered from your data. It informs judgment with numbers — it doesn't make the call for you."
        info={{
          what: "Ask questions about your project in plain English and get answers computed from your own figures — spend, stock, progress. It surfaces the numbers to inform your decision; it never makes the decision for you.",
          steps: [
            "Pick the project you're asking about.",
            "Type a question, e.g. 'How much have we spent on cement so far?'",
            "Read the answer with its figures — then you make the call.",
          ],
        }} />
      <AskBox projects={projects ?? []} />
    </div>
  );
}
