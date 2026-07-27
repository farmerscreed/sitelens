"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CreateTypeForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("terrace");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_create_building_type", {
      p_org: orgId, p_name: name, p_category: category,
    });
    setBusy(false);
    if (error) setErr(error.message);
    else { setName(""); router.refresh(); }
  }

  return (
    <div className="max-w-md space-y-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 className="text-sm font-medium">New building type</h2>
      <input
        className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        placeholder="e.g. Terrace Type A" value={name} onChange={(e) => setName(e.target.value)}
      />
      <select
        className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        value={category} onChange={(e) => setCategory(e.target.value)}
      >
        {["terrace", "duplex", "g+3", "bungalow", "custom"].map((c) => <option key={c}>{c}</option>)}
      </select>
      <button
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={submit} disabled={busy || !name}
      >
        {busy ? "Creating…" : "Create type"}
      </button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
