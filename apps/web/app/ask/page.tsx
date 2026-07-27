import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AskBox } from "@/components/AskBox";

export default async function AskPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: projects } = await supabase.from("projects").select("id,name").order("name");

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Ask</h1>
      <p className="text-sm text-neutral-500">
        Plain-language questions answered from your data (arithmetic over the figures). It
        informs judgment with numbers — it doesn&apos;t make the call for you.
      </p>
      <AskBox projects={projects ?? []} />
    </main>
  );
}
