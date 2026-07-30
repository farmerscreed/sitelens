"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconCheck, IconClose, IconSpark } from "@/components/icons";

type Proposal = { id: string; subject_type: string; output: any; confidence: number | null; created_at: string };
const ngn = (n: unknown) => (n == null ? "—" : `₦${Number(n).toLocaleString("en-NG")}`);

export function AiProposals({ proposals, orgId }: { proposals: Proposal[]; orgId?: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function resolve(p: Proposal, accept: boolean) {
    setBusy(true); setErr(null);
    // Price proposals: accepting APPLIES the price through the one server write
    // path (Rule 1) — the human has chosen between current and proposed.
    if (accept && p.subject_type === "price_proposal" && orgId && p.output?.material_id) {
      const { error } = await supabase.rpc("fn_set_material_price", {
        p_org: orgId, p_material: p.output.material_id, p_unit_price: Number(p.output.proposed_price),
      });
      if (error) { setErr(error.message); setBusy(false); return; }
    }
    const { error } = await supabase.rpc("fn_resolve_inference", { p_inference: p.id, p_accept: accept });
    setBusy(false);
    if (error) setErr(error.message); else router.refresh();
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
          {p.subject_type === "price_proposal" && p.output?.proposed_price != null ? (
            <div className="rounded-xl border border-white/[0.06] bg-black/30 p-3 text-sm">
              <p className="text-white">{String(p.output.from_text ?? "BOQ rate")}</p>
              <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
                <span className="text-[#8b95a7]">Current price: <strong className="text-[#c7cedb]">{ngn(p.output.current_price)}</strong></span>
                <span className="text-[#8b95a7]">BOQ rate: <strong className="text-accent-300">{ngn(p.output.proposed_price)}</strong> / {String(p.output.unit ?? "")}</span>
              </div>
              {p.output.note && <p className="mt-1.5 text-[11px] text-[#5b6473]">{String(p.output.note)}</p>}
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/30 p-3 text-xs text-[#c7cedb]">{JSON.stringify(p.output, null, 2)}</pre>
          )}
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => resolve(p, true)}>
              <IconCheck className="h-4 w-4" />{p.subject_type === "price_proposal" ? "Accept — set as current price" : "Accept"}
            </button>
            <button className="btn btn-ghost px-3 py-1.5 text-xs" disabled={busy} onClick={() => resolve(p, false)}>
              <IconClose className="h-4 w-4" />{p.subject_type === "price_proposal" ? "Keep current price" : "Reject"}
            </button>
          </div>
          {err && <p className="mt-2 text-xs text-red-300">{err}</p>}
        </li>
      ))}
    </ul>
  );
}
