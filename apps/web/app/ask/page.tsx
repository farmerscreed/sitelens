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
        subtitle="Plain-language questions answered from your data. It informs judgment with numbers — it doesn't make the call for you." />
      <AskBox projects={projects ?? []} />
    </div>
  );
}
