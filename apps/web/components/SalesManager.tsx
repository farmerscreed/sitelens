"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconAlert } from "@/components/icons";

type Building = { id: string; code: string };

// Create a sale: a BUYER buys a building on a milestone-linked plan, or a PARTNER
// (master developer / land owner) invests project-wide on a time-phased plan.
// fn_create_sale seeds the default tranches (Rule 1).
export function SalesManager({ orgId, projectId, buildings }: { orgId: string; projectId: string; buildings: Building[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [role, setRole] = useState<"buyer" | "partner">("buyer");
  const [bld, setBld] = useState(buildings[0]?.id ?? "");
  const [total, setTotal] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const plan = role === "partner" ? "time_phased" : "milestone";

  async function create() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_create_sale", {
      p_org: orgId, p_project: projectId, p_building: role === "buyer" ? (bld || null) : null,
      p_party_name: name.trim(), p_party_role: role, p_total: Number(total), p_plan_type: plan,
      p_email: email.trim() || null, p_phone: phone.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setName(""); setTotal(""); setEmail(""); setPhone("");
    router.refresh();
  }

  return (
    <section className="card max-w-2xl">
      <h2 className="text-sm font-semibold text-white">Add a sale</h2>
      <p className="mt-0.5 text-xs text-[#8b95a7]">
        Buyer → a house, paid as milestones are reached. Partner → the whole project, paid in time phases (30% + 4×17.5%).
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Who</label>
          <select className="select" value={role} onChange={(e) => setRole(e.target.value as "buyer" | "partner")}>
            <option value="buyer">Buyer (a house)</option>
            <option value="partner">Partner / master developer</option>
          </select>
        </div>
        {role === "buyer" && (
          <div>
            <label className="label">House</label>
            <select className="select" value={bld} onChange={(e) => setBld(e.target.value)}>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
              {buildings.length === 0 && <option value="">No buildings on this project</option>}
            </select>
          </div>
        )}
        <div className={role === "buyer" ? "" : "sm:col-span-1"}>
          <label className="label">Name</label>
          <input className="input" placeholder="Party name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Total price (₦)</label>
          <input type="number" min="0" className="input" placeholder="0" value={total} onChange={(e) => setTotal(e.target.value)} />
        </div>
        <div>
          <label className="label">Email <span className="text-[#5b6473]">(optional)</span></label>
          <input className="input" placeholder="—" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="label">Phone <span className="text-[#5b6473]">(optional)</span></label>
          <input className="input" placeholder="—" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy || !name.trim() || total === "" || (role === "buyer" && !bld)} onClick={create}>
          <IconPlus className="h-4 w-4" />{busy ? "Adding…" : "Add sale"}
        </button>
        <span className="text-xs text-[#5b6473]">Plan: {plan === "time_phased" ? "time-phased (partner)" : "milestone-linked (buyer)"}</span>
        {err && <span className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</span>}
      </div>
    </section>
  );
}
