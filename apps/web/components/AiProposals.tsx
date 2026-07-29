"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconClose, IconSpark } from "@/components/icons";

type Proposal = { id: string; subject_type: string; output: unknown; confidence: number | null; created_at: string };

export function AiProposals({ proposals }: { proposals: Proposal[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);

  async function resolve(id: string, accept: boolean) {
    setBusy(true);
    const { error } = await supabase.rpc("fn_resolve_inference", { p_inference: id, p_accept: accept });
    setBusy(false);
    if (!error) router.refresh();
  }

  if (proposals.length === 0)
    return (
      <div className="card flex flex-col items-center gap-2 py-12 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.03] text-accent-300"><IconSpark className="h-6 w-6" /></span>
        <p className="text-sm font-medium text-white">No pending proposals</p>
        <p className="max-w-sm text-xs text-[#8b95a7]">When the AI extracts a BOQ, spots a spend anomaly or suggests a reorder, it&apos;ll appear here for you to accept or reject.</p>
      </div>
    );

  return (
    <ul className="space-y-3">
      {proposals.map((p) => (
        <li key={p.id} className="card">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm font-semibold text-white">
              <IconSpark className="h-4 w-4 text-accent-300" />{p.subject_type}
            </span>
            {p.confidence != null && <span className="badge badge-muted">confidence {Math.round(p.confidence * 100)}%</span>}
          </div>
          <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/30 p-3 text-xs text-[#c7cedb]">{JSON.stringify(p.output, null, 2)}</pre>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => resolve(p.id, true)}><IconCheck className="h-4 w-4" />Accept</button>
            <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => resolve(p.id, false)}><IconClose className="h-4 w-4" />Reject</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
