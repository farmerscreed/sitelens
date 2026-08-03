"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconLink, IconCheck, IconAlert } from "@/components/icons";

type Building = { id: string; code: string };

// Send this client their portal link from their own page — name/email/phone are
// prefilled from the record, the view defaults to their house if they have one,
// and the link is filed under the client (p_client).
export function SendPortalLink({
  projectId, clientId, clientName, clientEmail, clientPhone, buildings,
}: {
  projectId: string; clientId: string; clientName: string;
  clientEmail: string | null; clientPhone: string | null; buildings: Building[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [type, setType] = useState<"buyer" | "partner">(buildings.length > 0 ? "buyer" : "partner");
  const [bld, setBld] = useState(buildings[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ url: string; pin: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true); setErr(null); setCreated(null);
    const { data, error } = await supabase.rpc("fn_create_portal_link", {
      p_project: projectId, p_recipient_name: clientName, p_recipient_phone: clientPhone,
      p_link_type: type, p_building: type === "buyer" ? (bld || null) : null,
      p_email: clientEmail, p_client: clientId,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    setCreated({ url: `${origin}/portal/${data.token}`, pin: data.pin });
    router.refresh();
  }
  function copy() {
    if (created) { navigator.clipboard?.writeText(`${created.url}\nPIN: ${created.pin}`); setCopied(true); setTimeout(() => setCopied(false), 1500); }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">View</label>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as "buyer" | "partner")}>
            {buildings.length > 0 && <option value="buyer">Buyer (their house)</option>}
            <option value="partner">Partner (whole project)</option>
          </select>
        </div>
        {type === "buyer" && buildings.length > 1 && (
          <div>
            <label className="label">House</label>
            <select className="select" value={bld} onChange={(e) => setBld(e.target.value)}>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
            </select>
          </div>
        )}
        <button className="btn btn-primary" disabled={busy || (type === "buyer" && !bld) || (!clientEmail && !clientPhone)} onClick={create}>
          <IconLink className="h-4 w-4" />{busy ? "Creating…" : "Send portal link"}
        </button>
      </div>
      {!clientEmail && !clientPhone && (
        <p className="mt-2 text-xs text-[#8b95a7]">Add an email or phone to this client first — the link is delivered to them.</p>
      )}
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
    </div>
  );
}
