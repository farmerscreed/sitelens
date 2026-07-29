"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert, IconPlus } from "@/components/icons";

export function CreateTypeForm({ orgId }: { orgId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("terrace");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_create_building_type", { p_org: orgId, p_name: name, p_category: category });
    setBusy(false);
    if (error) setErr(error.message);
    else { setName(""); router.refresh(); }
  }

  return (
    <section className="card max-w-xl">
      <h2 className="text-sm font-semibold text-white">New building type</h2>
      <p className="mt-1 text-xs text-[#8b95a7]">A reusable recipe you&apos;ll add stages and material quantities to.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Name</label>
          <input className="input" placeholder="e.g. Terrace Type A" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Category</label>
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {["terrace", "duplex", "g+3", "bungalow", "custom"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <button className="btn btn-primary mt-4" onClick={submit} disabled={busy || !name}>
        <IconPlus className="h-4 w-4" />{busy ? "Creating…" : "Create type"}
      </button>
      {err && <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </section>
  );
}
