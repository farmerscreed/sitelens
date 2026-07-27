import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AiProposals } from "@/components/AiProposals";

// AI proposes, humans dispose (Rule 3). Every AI output is a proposal here; a human's
// accept/reject becomes the training label (the flywheel).
export default async function AiPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: proposals } = await supabase
    .from("ai_inferences")
    .select("id,subject_type,output,confidence,created_at")
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">AI proposals</h1>
      <p className="text-sm text-neutral-500">
        Nothing here is committed until you accept it. Your verdict becomes a labelled
        example that improves the models over time.
      </p>
      <AiProposals proposals={proposals ?? []} />
    </main>
  );
}
