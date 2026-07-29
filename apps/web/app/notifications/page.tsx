import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/PageHeader";

// Dev notifications outbox. In production this is drained to WhatsApp/SMS/Resend; in dev
// messages are logged here instead (same interface).
export default async function NotificationsPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: msgs } = await supabase
    .from("dev_outbox")
    .select("id,channel,recipient,template,payload,status,created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        subtitle="Dev outbox — in production this drains to WhatsApp / SMS / Resend; in dev, messages are logged here (same interface)."
        info={{
          what: "Every message the system would send — client digests, approval requests, alerts — lands here. In production these go out over WhatsApp, SMS and email; while testing they're logged here instead, using the exact same pipeline.",
          steps: [
            "Browse recent messages, newest first.",
            "Each shows the channel, recipient and the exact payload that would be sent.",
          ],
        }} />
      <div className="space-y-3">
        {(msgs ?? []).map((m) => (
          <div key={m.id} className="card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-semibold text-white">
                {m.template ?? "message"}
                <span className="badge badge-blue">{m.channel}</span>
              </span>
              <span className="text-xs text-[#8b95a7]">{m.recipient} · {m.status}</span>
            </div>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-white/[0.06] bg-black/30 p-3 text-xs text-[#c7cedb]">{JSON.stringify(m.payload, null, 2)}</pre>
          </div>
        ))}
        {(msgs ?? []).length === 0 && <p className="card text-sm text-[#8b95a7]">No messages yet.</p>}
      </div>
    </div>
  );
}
