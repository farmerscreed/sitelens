"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconPlus, IconCheck, IconAlert, IconLink } from "@/components/icons";

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
  const [copied, setCopied] = useState(false);

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
  function copy() {
    if (created) { navigator.clipboard?.writeText(`${created.url}\nPIN: ${created.pin}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  }

  const statusBadge = (s: string) =>
    s === "active" ? "badge-green" : s === "revoked" ? "badge-red" : "badge-muted";

  return (
    <div className="space-y-5">
      <div className="card p-0 overflow-hidden">
        <h2 className="px-5 pt-5 text-sm font-semibold text-white">Shared links</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr><th>Recipient</th><th>Line items</th><th>Last opened</th><th>Status</th><th className="text-right">Actions</th></tr>
            </thead>
            <tbody>
              {links.map((l) => {
                const expired = new Date(l.expires_at) < new Date();
                const status = l.revoked_at ? "revoked" : expired ? "expired" : "active";
                return (
                  <tr key={l.id}>
                    <td className="font-medium text-white">{l.recipient_name ?? "—"}</td>
                    <td className="text-[#8b95a7]">{l.show_line_items ? "shown" : "hidden"}</td>
                    <td className="whitespace-nowrap text-[#8b95a7]">{l.last_opened ? new Date(l.last_opened).toLocaleString() : "never"}</td>
                    <td><span className={`badge ${statusBadge(status)}`}>{status}</span></td>
                    <td className="text-right">
                      {status === "active" && <button className="btn btn-danger px-2.5 py-1 text-xs" disabled={busy} onClick={() => revoke(l.id)}>Revoke</button>}
                    </td>
                  </tr>
                );
              })}
              {links.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-[#8b95a7]">No portal links yet — create one below.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <section className="card max-w-xl">
        <h2 className="text-sm font-semibold text-white">New portal link</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Recipient name</label>
            <input className="input" placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" placeholder="+234…" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-[#c7cedb]">
          <input type="checkbox" checked={lineItems} onChange={(e) => setLineItems(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-transparent accent-accent-500" />
          Show itemised line items to the client
        </label>
        <button className="btn btn-primary mt-4" disabled={busy || !name || !phone} onClick={create}>
          <IconLink className="h-4 w-4" />Create link
        </button>

        {created && (
          <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-4">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-300"><IconCheck className="h-4 w-4" />Share these once — not stored again</p>
              <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={copy}>{copied ? "Copied!" : "Copy"}</button>
            </div>
            <p className="mt-2 break-all font-mono text-xs text-[#c7cedb]">{created.url}</p>
            <p className="mt-1 text-sm text-white">PIN: <span className="font-mono text-accent-300">{created.pin}</span></p>
          </div>
        )}
        {err && <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
      </section>
    </div>
  );
}
