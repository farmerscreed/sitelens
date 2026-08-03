"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconAlert, IconCheck, IconTrash } from "@/components/icons";

type ClientRow = { id: string; full_name: string; email: string | null; phone: string | null; notes: string | null };

// Edit contact/notes inline; archive is two-tap and the server refuses while
// the client still owes money (you can't hide someone with a balance).
export function ClientEditor({ client }: { client: ClientRow }) {
  const router = useRouter();
  const supabase = createClient();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(client.full_name);
  const [email, setEmail] = useState(client.email ?? "");
  const [phone, setPhone] = useState(client.phone ?? "");
  const [notes, setNotes] = useState(client.notes ?? "");

  async function save() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_update_client", {
      p_client: client.id, p_full_name: name.trim(), p_email: email.trim() || null,
      p_phone: phone.trim() || null, p_notes: notes.trim() || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEditing(false);
    router.refresh();
  }

  async function archive() {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_archive_client", { p_client: client.id });
    setBusy(false);
    if (error) { setErr(error.message); setConfirming(false); return; }
    router.replace("/clients");
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => setEditing(true)}>Edit</button>
        {confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-xs text-[#8b95a7]">Archive {client.full_name}? They leave the directory; their sales stay.</span>
            <button className="btn btn-danger px-2.5 py-1 text-xs" disabled={busy} onClick={archive}>Yes, archive</button>
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={() => setConfirming(false)}>Cancel</button>
          </span>
        ) : (
          <button className="btn btn-ghost px-2.5 py-1 text-xs text-red-300" onClick={() => setConfirming(true)}>
            <IconTrash className="h-3.5 w-3.5" />Archive
          </button>
        )}
        {err && <span className="flex items-center gap-1.5 text-xs text-red-300"><IconAlert className="h-4 w-4" />{err}</span>}
      </div>
    );
  }

  return (
    <div className="card mt-2 max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><label className="label">Email</label><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className="label">Phone</label><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div><label className="label">Notes</label><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}><IconCheck className="h-4 w-4" />Save</button>
        <button className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
        {err && <span className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</span>}
      </div>
    </div>
  );
}
