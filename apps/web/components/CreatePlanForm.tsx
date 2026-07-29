"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert, IconPlus } from "@/components/icons";

export function CreatePlanForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"funding_required" | "max_delivery">("funding_required");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("fn_create_plan", { p_org: orgId, p_name: name, p_mode: mode });
    setBusy(false);
    if (error) setErr(error.message);
    else router.push(`/planner/${data}`);
  }

  return (
    <section className="card max-w-xl">
      <h2 className="text-sm font-semibold text-white">New scenario</h2>
      <div className="mt-4 space-y-3">
        <div>
          <label className="label">Scenario name</label>
          <input className="input" placeholder="e.g. 5-at-a-time" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Mode</label>
          <select className="select" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
            <option value="funding_required">Funding required — what cash, and when</option>
            <option value="max_delivery">Max delivery — how far does the cash go</option>
          </select>
        </div>
      </div>
      <button className="btn btn-primary mt-4" onClick={submit} disabled={busy || !name}>
        <IconPlus className="h-4 w-4" />{busy ? "Creating…" : "Create scenario"}
      </button>
      {err && <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </section>
  );
}
