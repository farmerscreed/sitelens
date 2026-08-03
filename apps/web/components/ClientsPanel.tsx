"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconAlert, IconCheck } from "@/components/icons";

type UnlinkedSale = { id: string; party_name: string; party_email: string | null; party_phone: string | null };

// Add a client by hand, and pull the few pre-hub sales (no client yet) into the
// directory with one tap — fn_create_client get-or-creates on email, so linking
// two sales by the same person lands on one client. The panel disappears once
// every sale is linked.
export function ClientsPanel({ orgId, unlinked }: { orgId: string; unlinked: UnlinkedSale[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  async function add() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_create_client", {
      p_org: orgId, p_full_name: name.trim(), p_email: email.trim() || null,
      p_phone: phone.trim() || null, p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setName(""); setEmail(""); setPhone(""); setNotes("");
    router.refresh();
  }

  async function linkSale(s: UnlinkedSale) {
    setBusy(true); setErr(null);
    const { data: cid, error } = await supabase.rpc("fn_create_client", {
      p_org: orgId, p_full_name: s.party_name, p_email: s.party_email, p_phone: s.party_phone,
    });
    if (error) { setBusy(false); setErr(error.message); return; }
    const { error: e2 } = await supabase.rpc("fn_link_sale_client", { p_sale: s.id, p_client: cid });
    setBusy(false);
    if (e2) { setErr(e2.message); return; }
    router.refresh();
  }

  return (
    <div className="space-y-5">
      {unlinked.length > 0 && (
        <section className="card border-accent-500/20">
          <h2 className="text-sm font-semibold text-white">Sales not in the directory yet</h2>
          <p className="mt-0.5 text-xs text-[#8b95a7]">These sales were recorded before the client directory existed. One tap files each under a client (matched by email if they already exist).</p>
          <div className="mt-3 space-y-1.5">
            {unlinked.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2">
                <span className="min-w-0 truncate text-sm text-white">{s.party_name}
                  <span className="ml-2 text-xs text-[#5b6473]">{s.party_email ?? s.party_phone ?? ""}</span>
                </span>
                <button className="btn btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => linkSale(s)}>
                  <IconCheck className="h-3.5 w-3.5" />Add to directory
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="card max-w-2xl">
        <h2 className="text-sm font-semibold text-white">Add a client</h2>
        <p className="mt-0.5 text-xs text-[#8b95a7]">Most clients are created automatically when you record their first sale — add one here only if they haven&apos;t bought yet.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Name</label>
            <input className="input" placeholder="Full name / company" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Email <span className="text-[#5b6473]">(optional)</span></label>
            <input className="input" placeholder="—" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="label">Phone <span className="text-[#5b6473]">(optional)</span></label>
            <input className="input" placeholder="—" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Notes <span className="text-[#5b6473]">(optional)</span></label>
            <input className="input" placeholder="—" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={add}>
            <IconPlus className="h-4 w-4" />{busy ? "Adding…" : "Add client"}
          </button>
          {err && <span className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</span>}
        </div>
      </section>
    </div>
  );
}
