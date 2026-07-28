"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Link = {
  id: string; recipient_name: string | null; recipient_phone: string | null;
  show_line_items: boolean; expires_at: string; revoked_at: string | null;
  created_at: string; last_opened: string | null;
};

export function PortalLinksPanel({ projectId, links }: { projectId: string; links: Link[] }) {
  const router = useRouter();
  const supabase = createClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [lineItems, setLineItems] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string; pin: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null); setCreated(null);
    const { data, error } = await supabase.rpc("fn_create_portal_link", {
      p_project: projectId, p_recipient_name: name, p_recipient_phone: phone, p_show_line_items: lineItems,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setCreated({ url: `${origin}/portal/${data.token}`, pin: data.pin });
    setName(""); setPhone(""); router.refresh();
  }

  async function revoke(id: string) {
    setBusy(true);
    const { error } = await supabase.rpc("fn_revoke_portal_link", { p_link: id });
    setBusy(false);
    if (!error) router.refresh();
  }

  return (
    <div className="space-y-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
            <th className="py-1">Recipient</th><th>Line items</th><th>Last opened</th><th>Status</th><th></th>
          </tr>
        </thead>
        <tbody>
          {links.map((l) => {
            const expired = new Date(l.expires_at) < new Date();
            const status = l.revoked_at ? "revoked" : expired ? "expired" : "active";
            return (
              <tr key={l.id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1">{l.recipient_name ?? "—"}</td>
                <td className="text-neutral-500">{l.show_line_items ? "shown" : "hidden"}</td>
                <td className="text-neutral-500">{l.last_opened ? new Date(l.last_opened).toLocaleString() : "never"}</td>
                <td>{status}</td>
                <td className="text-right">
                  {status === "active" && <button className="rounded border px-2 py-0.5 text-xs dark:border-neutral-700" disabled={busy} onClick={() => revoke(l.id)}>Revoke</button>}
                </td>
              </tr>
            );
          })}
          {links.length === 0 && <tr><td colSpan={5} className="py-2 text-neutral-500">No portal links yet.</td></tr>}
        </tbody>
      </table>

      <div className="max-w-lg space-y-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="text-sm font-medium">New portal link</h2>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <input className="rounded border px-2 py-1 dark:bg-neutral-900" placeholder="Recipient name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="rounded border px-2 py-1 dark:bg-neutral-900" placeholder="Phone (+234…)" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <label className="flex items-center gap-1"><input type="checkbox" checked={lineItems} onChange={(e) => setLineItems(e.target.checked)} />line items</label>
          <button className="rounded bg-neutral-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900" disabled={busy || !name || !phone} onClick={create}>Create</button>
        </div>
        {created && (
          <div className="rounded bg-green-50 p-3 text-sm dark:bg-green-950/30">
            <p className="font-medium">Share these separately (shown once):</p>
            <p className="break-all font-mono text-xs">{created.url}</p>
            <p>PIN: <span className="font-mono">{created.pin}</span></p>
          </div>
        )}
        {err && <p className="text-sm text-red-600">{err}</p>}
      </div>
    </div>
  );
}
