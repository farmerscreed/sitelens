"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

  if (proposals.length === 0) return <p className="text-sm text-neutral-500">No pending proposals.</p>;

  return (
    <ul className="space-y-3">
      {proposals.map((p) => (
        <li key={p.id} className="rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium">{p.subject_type}</span>
            <span className="text-xs text-neutral-500">{p.confidence != null ? `conf ${p.confidence}` : ""}</span>
          </div>
          <pre className="overflow-x-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-900">{JSON.stringify(p.output, null, 2)}</pre>
          <div className="mt-2 flex gap-2">
            <button className="rounded bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-50" disabled={busy} onClick={() => resolve(p.id, true)}>Accept</button>
            <button className="rounded border px-3 py-1 text-xs dark:border-neutral-700" disabled={busy} onClick={() => resolve(p.id, false)}>Reject</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
