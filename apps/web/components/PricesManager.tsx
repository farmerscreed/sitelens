"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconTag, IconCheck, IconAlert, IconChevron } from "@/components/icons";

type Material = { id: string; name: string; unit: string };
type Price = { id: string; material_id: string; unit_price: number; effective_from: string };

const naira = (n: number) => "₦" + n.toLocaleString();

// Price list editor. Set/edit → fn_set_material_price (same date = in-place correction).
// Delete a dated entry → fn_delete_material_price. Both are admin-only server functions.
export function PricesManager({ orgId, today, materials, prices }: {
  orgId: string; today: string; materials: Material[]; prices: Price[];
}) {
  const router = useRouter();
  const supabase = createClient();
  const [drafts, setDrafts] = useState<Record<string, { price: string; date: string }>>({});
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);

  const historyOf = (mid: string) =>
    prices.filter((p) => p.material_id === mid)
          .sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  const currentOf = (mid: string) => {
    const past = historyOf(mid).filter((p) => p.effective_from <= today);
    return past[0]?.unit_price ?? null;
  };
  const draft = (mid: string) => drafts[mid] ?? { price: "", date: today };
  const setDraft = (mid: string, patch: Partial<{ price: string; date: string }>) =>
    setDrafts((d) => ({ ...d, [mid]: { ...draft(mid), ...patch } }));

  async function save(mid: string) {
    const d = draft(mid);
    if (d.price === "" || Number(d.price) < 0) return;
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_set_material_price", {
      p_org: orgId, p_material: mid, p_unit_price: Number(d.price), p_effective_from: d.date || today,
    });
    setBusy(false);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: "Price saved." }); setDraft(mid, { price: "" }); router.refresh(); }
  }

  async function del(priceId: string) {
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("fn_delete_material_price", { p_price_id: priceId });
    setBusy(false); setConfirmDel(null);
    if (error) setMsg({ ok: false, t: error.message });
    else { setMsg({ ok: true, t: "Price entry deleted." }); router.refresh(); }
  }

  if (materials.length === 0)
    return <p className="card text-sm text-[#8b95a7]">No materials in this org yet.</p>;

  return (
    <div className="space-y-4">
      {msg && (
        <div className={`flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
          msg.ok ? "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-300"
                 : "border-red-500/20 bg-red-500/[0.06] text-red-300"}`}>
          {msg.ok ? <IconCheck className="h-4 w-4" /> : <IconAlert className="h-4 w-4" />}{msg.t}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {materials.map((m) => {
          const cur = currentOf(m.id);
          const hist = historyOf(m.id);
          const d = draft(m.id);
          const open = openHistory === m.id;
          return (
            <div key={m.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-accent-300">
                    <IconTag className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">{m.name}</p>
                    <p className="text-xs text-[#8b95a7]">per {m.unit}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase tracking-wider text-[#5b6473]">Current</p>
                  <p className="font-mono text-lg font-semibold text-white">{cur != null ? naira(cur) : "—"}</p>
                </div>
              </div>

              {/* Set / edit */}
              <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <label className="label">New price (₦)</label>
                  <input type="number" min="0" step="0.01" className="input" placeholder="0.00"
                    value={d.price} onChange={(e) => setDraft(m.id, { price: e.target.value })} />
                </div>
                <div className="sm:w-40">
                  <label className="label">Effective from</label>
                  <input type="date" className="input" value={d.date}
                    onChange={(e) => setDraft(m.id, { date: e.target.value })} />
                </div>
                <button className="btn btn-primary shrink-0" disabled={busy || d.price === ""}
                  onClick={() => save(m.id)}>{busy ? "…" : "Save"}</button>
              </div>

              {/* History */}
              {hist.length > 0 && (
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  <button onClick={() => setOpenHistory(open ? null : m.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-[#8b95a7] transition hover:text-white">
                    <IconChevron className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`} />
                    Price history ({hist.length})
                  </button>
                  {open && (
                    <ul className="mt-2 space-y-1">
                      {hist.map((p) => (
                        <li key={p.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-3 py-1.5 text-sm">
                          <span className="font-mono text-[#c7cedb]">{naira(p.unit_price)}</span>
                          <span className="text-xs text-[#8b95a7]">{p.effective_from}</span>
                          {confirmDel === p.id ? (
                            <span className="flex items-center gap-1">
                              <button className="btn btn-danger px-2 py-0.5 text-xs" disabled={busy} onClick={() => del(p.id)}>Confirm</button>
                              <button className="btn btn-ghost px-2 py-0.5 text-xs" onClick={() => setConfirmDel(null)}>Cancel</button>
                            </span>
                          ) : (
                            <button className="text-xs text-[#8b95a7] transition hover:text-red-300" onClick={() => setConfirmDel(p.id)}>Delete</button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
