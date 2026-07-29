import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AiProposals } from "@/components/AiProposals";
import { PageHeader } from "@/components/PageHeader";

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
    <div className="space-y-6">
      <PageHeader
        title="AI proposals"
        subtitle="Nothing here is committed until you accept it. Your verdict becomes a labelled example that improves the models over time."
        info={{
          what: "Where the AI's suggestions wait for your decision — extracted BOQ rows, reorder advice, spend anomalies. Nothing is ever applied automatically: you accept or reject, and your verdict trains the models to get better.",
          steps: [
            "Review each proposal and its confidence.",
            "Accept to apply it, or reject if it's wrong.",
            "Either way your choice is recorded as a training example.",
          ],
        }} />
      <AiProposals proposals={proposals ?? []} />
    </div>
  );
}
