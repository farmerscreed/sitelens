"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IconLogo, IconAlert, IconBoard, IconReceipt } from "@/components/icons";

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
      <div className="mx-auto max-w-lg space-y-5 px-4 py-10">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-sheen text-ink-950"><IconLogo className="h-5 w-5" /></span>
          <span className="text-sm font-semibold text-white">Site<span className="gradient-text">Lens</span></span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">{view.project}</h1>
          <p className="text-sm text-[#8b95a7]">Project update</p>
        </div>

        <section className="card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]"><IconBoard className="h-4 w-4 text-accent-300" />Progress</div>
          <div className="mt-2 text-4xl font-semibold text-white">{view.progress.pct}%</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-accent-sheen" style={{ width: `${view.progress.pct}%` }} />
          </div>
          <div className="mt-2 text-sm text-[#8b95a7]">{view.progress.buildings_done} of {view.progress.buildings_total} buildings complete</div>
        </section>

        <section className="card">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]"><IconReceipt className="h-4 w-4 text-accent-300" />Spend vs budget</div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-[#8b95a7]">Budget</dt><dd className="mt-0.5 font-mono text-white">{naira(view.spend.budget)}</dd></div>
            <div><dt className="text-[#8b95a7]">Spent</dt><dd className="mt-0.5 font-mono text-white">{naira(view.spend.spent)}</dd></div>
            <div><dt className="text-[#8b95a7]">Committed</dt><dd className="mt-0.5 font-mono text-white">{naira(view.spend.committed)}</dd></div>
          </dl>
          {view.line_items && (
            <div className="mt-3 overflow-x-auto">
              <table className="table-base">
                <tbody>
                  {view.line_items.map((l, k) => (
                    <tr key={k}><td className="text-[#c7cedb]">{l.category ?? "—"}</td><td className="text-right font-mono">{naira(l.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <p className="text-center text-sm text-[#8b95a7]">{view.photo_count} site photos on file.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-accent-sheen text-ink-950 shadow-glow"><IconLogo className="h-8 w-8" /></span>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-white">Client portal</h1>
          <p className="mt-1 text-sm text-[#8b95a7]">Enter the PIN sent to you to view your project.</p>
        </div>
        <div className="card">
          <label className="label">PIN</label>
          <input className="input text-center text-lg font-semibold tracking-[0.4em]"
            inputMode="numeric" placeholder="••••••" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && pin.length >= 6 && open()} autoFocus />
          <button className="btn btn-primary mt-4 w-full" onClick={open} disabled={busy || pin.length < 6}>
            {busy ? "Opening…" : "View project"}
          </button>
          {err && <p className="mt-3 flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
        </div>
      </div>
    </div>
  );
}
