"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { IconLogo, IconAlert, IconBoard, IconReceipt } from "@/components/icons";

type Milestone = { milestone: string; status: string };
type Tranche = { label: string; amount: number; status: string; due: boolean };
type BuyerView = {
  view: "buyer"; project: string; building_code: string; progress_pct: number;
  milestones: Milestone[]; photo_count: number;
  payment: { total: number; paid: number; outstanding: number; schedule: Tranche[] } | null;
};
type PartnerView = {
  view: "partner"; project: string;
  progress: { buildings_total: number; buildings_done: number; pct: number };
  units_by_milestone: { milestone: string; reached: number; total: number }[];
  financials: { budget: number; spent: number };
  sales: { units_sold: number; contract_value: number; collected: number };
  photo_count: number;
};
type View = BuyerView | PartnerView;

const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();

function Stepper({ milestones }: { milestones: Milestone[] }) {
  const items = [...milestones, { milestone: "Handover", status: "not_started" }];
  return (
    <div className="mt-4 flex items-start gap-1 overflow-x-auto pb-1">
      {items.map((ms, i) => (
        <div key={ms.milestone} className="flex items-center gap-1">
          <div className="flex min-w-[76px] flex-col items-center gap-1.5 px-1">
            <span className={`grid h-8 w-8 place-items-center rounded-full text-xs font-bold ${
              ms.status === "done" ? "bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/40"
              : ms.status === "in_progress" ? "bg-accent-500/20 text-accent-300 ring-1 ring-accent-400/50 shadow-glow"
              : "bg-white/[0.04] text-[#5b6473] ring-1 ring-white/[0.08]"}`}>
              {ms.status === "done" ? "✓" : i + 1}
            </span>
            <span className={`text-center text-[11px] leading-tight ${ms.status === "not_started" ? "text-[#5b6473]" : "text-[#c7cedb]"}`}>{ms.milestone}</span>
          </div>
          {i < items.length - 1 && <span className={`mt-4 h-0.5 w-4 shrink-0 rounded ${ms.status === "done" ? "bg-emerald-400/40" : "bg-white/[0.08]"}`} />}
        </div>
      ))}
    </div>
  );
}

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

        {view.view === "buyer" ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{view.building_code}</h1>
              <p className="text-sm text-[#8b95a7]">{view.project} · your home</p>
            </div>
            <section className="card">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]"><IconBoard className="h-4 w-4 text-accent-300" />Progress</div>
              <div className="mt-2 text-4xl font-semibold text-white">{view.progress_pct}%</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-accent-sheen" style={{ width: `${view.progress_pct}%` }} /></div>
              <Stepper milestones={view.milestones} />
            </section>
            {view.payment && (
              <section className="card">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]"><IconReceipt className="h-4 w-4 text-accent-300" />Your payments</div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                  <div><dt className="text-[#8b95a7]">Price</dt><dd className="mt-0.5 font-mono text-white">{naira(view.payment.total)}</dd></div>
                  <div><dt className="text-[#8b95a7]">Paid</dt><dd className="mt-0.5 font-mono text-emerald-300">{naira(view.payment.paid)}</dd></div>
                  <div><dt className="text-[#8b95a7]">Balance</dt><dd className="mt-0.5 font-mono text-white">{naira(view.payment.outstanding)}</dd></div>
                </dl>
                <div className="mt-4 space-y-1.5">
                  {view.payment.schedule.map((t, k) => (
                    <div key={k} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-2 text-sm">
                      <span className="text-[#c7cedb]">{t.label}
                        {t.status === "paid" ? <span className="ml-2 badge badge-green">paid</span>
                          : t.due ? <span className="ml-2 badge badge-accent">due</span>
                          : <span className="ml-2 text-xs text-[#5b6473]">upcoming</span>}
                      </span>
                      <span className="font-mono text-white">{naira(t.amount)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <p className="text-center text-sm text-[#8b95a7]">{view.photo_count} site photos on file.</p>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-white">{view.project}</h1>
              <p className="text-sm text-[#8b95a7]">Partner update</p>
            </div>
            <section className="card">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]"><IconBoard className="h-4 w-4 text-accent-300" />Overall progress</div>
              <div className="mt-2 text-4xl font-semibold text-white">{view.progress.pct}%</div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-accent-sheen" style={{ width: `${view.progress.pct}%` }} /></div>
              <div className="mt-2 text-sm text-[#8b95a7]">{view.progress.buildings_done} of {view.progress.buildings_total} homes complete</div>
            </section>
            <section className="card">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#8b95a7]">Homes by milestone</div>
              <div className="mt-3 space-y-2">
                {view.units_by_milestone.map((m, k) => (
                  <div key={k}>
                    <div className="flex items-center justify-between text-sm"><span className="text-[#c7cedb]">{m.milestone}</span><span className="font-mono text-[#8b95a7]">{m.reached}/{m.total}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-accent-sheen" style={{ width: `${m.total ? (m.reached / m.total) * 100 : 0}%` }} /></div>
                  </div>
                ))}
              </div>
            </section>
            <section className="card">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#8b95a7]"><IconReceipt className="h-4 w-4 text-accent-300" />Financials</div>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-[#8b95a7]">Budget</dt><dd className="mt-0.5 font-mono text-white">{naira(view.financials.budget)}</dd></div>
                <div><dt className="text-[#8b95a7]">Spent</dt><dd className="mt-0.5 font-mono text-white">{naira(view.financials.spent)}</dd></div>
                <div><dt className="text-[#8b95a7]">Homes sold</dt><dd className="mt-0.5 font-mono text-white">{view.sales.units_sold}</dd></div>
                <div><dt className="text-[#8b95a7]">Contract value</dt><dd className="mt-0.5 font-mono text-white">{naira(view.sales.contract_value)}</dd></div>
                <div><dt className="text-[#8b95a7]">Collected</dt><dd className="mt-0.5 font-mono text-emerald-300">{naira(view.sales.collected)}</dd></div>
              </dl>
            </section>
            <p className="text-center text-sm text-[#8b95a7]">{view.photo_count} site photos on file.</p>
          </>
        )}
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
