"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CreatePlanForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"funding_required" | "max_delivery">("funding_required");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("fn_create_plan", {
      p_org: orgId, p_name: name, p_mode: mode,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else router.push(`/planner/${data}`);
  }

  return (
    <div className="max-w-md space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-sm font-medium">New scenario</h2>
      <input className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        placeholder="e.g. 5-at-a-time" value={name} onChange={(e) => setName(e.target.value)} />
      <select className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
        <option value="funding_required">Funding required (what cash, when)</option>
        <option value="max_delivery">Max delivery (how far does cash go)</option>
      </select>
      <button className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={submit} disabled={busy || !name}>{busy ? "Creating…" : "Create scenario"}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
