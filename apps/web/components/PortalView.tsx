"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type View = {
  project: string;
  progress: { buildings_total: number; buildings_done: number; pct: number };
  spend: { budget: number; spent: number; committed: number };
  photo_count: number;
  line_items: { category: string; amount: number }[] | null;
};

const naira = (n: number) => "₦" + Number(n).toLocaleString();

export function PortalView({ token }: { token: string }) {
  const supabase = createClient();
  const [pin, setPin] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true); setErr(null);
    const { data, error } = await supabase.rpc("fn_portal_view", { p_token: token, p_pin: pin });
    setBusy(false);
    if (error) setErr(error.message);
    else if (data?.error) setErr(data.error);
    else setView(data as View);
  }

  if (view) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">{view.project}</h1>
          <p className="text-sm text-neutral-500">Project update</p>
        </div>
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="text-sm text-neutral-500">Progress</div>
          <div className="text-3xl font-semibold">{view.progress.pct}%</div>
          <div className="text-sm text-neutral-500">{view.progress.buildings_done} of {view.progress.buildings_total} buildings complete</div>
        </section>
        <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          <div className="mb-2 text-sm text-neutral-500">Spend vs budget</div>
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-neutral-500">Budget</dt><dd className="font-mono">{naira(view.spend.budget)}</dd></div>
            <div><dt className="text-neutral-500">Spent</dt><dd className="font-mono">{naira(view.spend.spent)}</dd></div>
            <div><dt className="text-neutral-500">Committed</dt><dd className="font-mono">{naira(view.spend.committed)}</dd></div>
          </dl>
          {view.line_items && (
            <table className="mt-3 w-full text-sm">
              <tbody>
                {view.line_items.map((l, k) => (
                  <tr key={k}><td className="py-0.5">{l.category ?? "—"}</td><td className="text-right font-mono">{naira(l.amount)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <p className="text-sm text-neutral-500">{view.photo_count} site photos on file.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Client portal</h1>
      <p className="text-sm text-neutral-500">Enter the 6-digit PIN sent to you separately.</p>
      <input
        className="w-full rounded-md border border-neutral-300 px-3 py-2 tracking-widest dark:border-neutral-700 dark:bg-neutral-900"
        inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
      <button className="w-full rounded-md bg-neutral-900 px-3 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={open} disabled={busy || pin.length < 6}>{busy ? "Opening…" : "View project"}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
