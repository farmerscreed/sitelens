import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
    <main className="space-y-4">
      <h1 className="text-xl font-semibold">Notifications (dev outbox)</h1>
      <ul className="space-y-2 text-sm">
        {(msgs ?? []).map((m) => (
          <li key={m.id} className="rounded-lg border border-neutral-200 p-3 dark:border-neutral-800">
            <div className="flex items-center justify-between">
              <span className="font-medium">{m.template ?? "message"} · {m.channel}</span>
              <span className="text-xs text-neutral-500">{m.recipient} · {m.status}</span>
            </div>
            <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 p-2 text-xs dark:bg-neutral-900">{JSON.stringify(m.payload, null, 2)}</pre>
          </li>
        ))}
        {(msgs ?? []).length === 0 && <li className="text-neutral-500">No messages yet.</li>}
      </ul>
    </main>
  );
}
