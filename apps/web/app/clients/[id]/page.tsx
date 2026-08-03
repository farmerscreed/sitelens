import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { IconChevron } from "@/components/icons";
import { ClientEditor } from "@/components/ClientEditor";
import { SendPortalLink } from "@/components/SendPortalLink";

const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();

type Summary = {
  client_id: string; full_name: string; email: string | null; phone: string | null; notes: string | null;
  kind: string | null; sale_count: number; houses: number;
  contract_value: string; paid: string; outstanding: string;
  due_now: string; next_due_label: string | null; overdue: boolean;
};
type Sale = { id: string; party_role: string; plan_type: string; building_id: string | null; project_id: string };
type Sps = { sale_id: string; total_amount: string; paid: string; outstanding: string };
type Tranche = { sale_id: string; seq: number; label: string; amount: string; pay_status: string; is_due: boolean };
type MsRow = { building_id: string; milestone: string; milestone_order: number; status: string };
type PLink = { id: string; link_type: string; building_id: string | null; expires_at: string; revoked_at: string | null };

// The internal mirror of the client portal: who they are, what they bought,
// what they've paid, what's due next, and their portal access.
export default async function ClientDetail({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: c } = await supabase.from("client_summary").select("*").eq("client_id", params.id).maybeSingle();
  if (!c) redirect("/clients");
  const client = c as Summary;

  const { data: salesRows } = await supabase.from("sales")
    .select("id,party_role,plan_type,building_id,project_id")
    .eq("client_id", params.id).is("archived_at", null).order("created_at");
  const sales = (salesRows ?? []) as Sale[];
  const saleIds = sales.map((s) => s.id);
  const buildingIds = [...new Set(sales.map((s) => s.building_id).filter(Boolean))] as string[];

  const [{ data: spsRows }, { data: trancheRows }, { data: bldRows }, { data: msRows }, { data: linkRows }, { data: accessRows }, { data: projRows }] = await Promise.all([
    saleIds.length ? supabase.from("sale_payment_summary").select("sale_id,total_amount,paid,outstanding").in("sale_id", saleIds) : Promise.resolve({ data: [] }),
    saleIds.length ? supabase.from("payment_schedule").select("sale_id,seq,label,amount,pay_status,is_due").in("sale_id", saleIds).order("seq") : Promise.resolve({ data: [] }),
    buildingIds.length ? supabase.from("buildings").select("id,code,status").in("id", buildingIds) : Promise.resolve({ data: [] }),
    buildingIds.length ? supabase.from("building_milestones").select("building_id,milestone,milestone_order,status").in("building_id", buildingIds) : Promise.resolve({ data: [] }),
    supabase.from("portal_links").select("id,link_type,building_id,expires_at,revoked_at").eq("client_id", params.id).order("created_at", { ascending: false }),
    supabase.from("portal_access_log").select("link_id,accessed_at,pin_success").order("accessed_at", { ascending: false }).limit(200),
    supabase.from("projects").select("id,name").is("archived_at", null).order("name"),
  ]);

  const sps = new Map(((spsRows ?? []) as Sps[]).map((r) => [r.sale_id, r]));
  const tranches = (trancheRows ?? []) as Tranche[];
  const bldOf = new Map(((bldRows ?? []) as { id: string; code: string; status: string }[]).map((b) => [b.id, b]));
  const links = (linkRows ?? []) as PLink[];
  const lastOpened = new Map<string, string>();
  for (const a of (accessRows ?? []) as { link_id: string; accessed_at: string; pin_success: boolean }[])
    if (a.pin_success && !lastOpened.has(a.link_id)) lastOpened.set(a.link_id, a.accessed_at);

  // Portal links are project-scoped: use the project of their sales, else the first project.
  const projectId = sales[0]?.project_id ?? (projRows ?? [])[0]?.id ?? null;
  const houseList = buildingIds.map((id) => bldOf.get(id)).filter(Boolean) as { id: string; code: string; status: string }[];

  // Per-house milestone strip (same shape as the building page, + synthesized Handover).
  const msByBld = new Map<string, MsRow[]>();
  for (const m of (msRows ?? []) as MsRow[]) {
    if (m.milestone === "Other") continue;
    if (!msByBld.has(m.building_id)) msByBld.set(m.building_id, []);
    msByBld.get(m.building_id)!.push(m);
  }

  const roleLabel = client.kind === "both" ? "Buyer + partner" : client.kind === "partner" ? "Partner / master developer" : client.kind === "buyer" ? "Buyer" : "No sales yet";
  const linkStatus = (l: PLink) => (l.revoked_at ? "revoked" : new Date(l.expires_at) < new Date() ? "expired" : "active");
  const statusBadge = (s: string) => (s === "active" ? "badge-green" : s === "revoked" ? "badge-red" : "badge-muted");

  return (
    <div className="space-y-6">
      <Link href="/clients" className="inline-flex items-center gap-1 text-sm text-[#8b95a7] hover:text-white">
        <IconChevron className="h-4 w-4 rotate-90" />Back to clients
      </Link>

      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{client.full_name}</h1>
          {client.overdue && <span className="badge badge-accent">payment due</span>}
        </div>
        <p className="mt-0.5 text-sm text-[#8b95a7]">
          {roleLabel} · {client.email ?? "no email"} · {client.phone ?? "no phone"}
        </p>
        {client.notes && <p className="mt-1 text-sm text-[#c7cedb]">{client.notes}</p>}
        <div className="mt-2"><ClientEditor client={{ id: client.client_id, full_name: client.full_name, email: client.email, phone: client.phone, notes: client.notes }} /></div>
      </header>

      {/* Money card */}
      <section className="card">
        <div className="grid gap-4 sm:grid-cols-4">
          <div><div className="stat-label">Contract value</div><div className="mt-1 font-mono text-xl font-semibold text-white">{naira(Number(client.contract_value))}</div></div>
          <div><div className="stat-label">Paid</div><div className="mt-1 font-mono text-xl font-semibold text-emerald-300">{naira(Number(client.paid))}</div></div>
          <div><div className="stat-label">Outstanding</div><div className="mt-1 font-mono text-xl font-semibold text-white">{naira(Number(client.outstanding))}</div></div>
          <div>
            <div className="stat-label">Due now</div>
            <div className={`mt-1 font-mono text-xl font-semibold ${client.overdue ? "text-accent-300" : "text-[#5b6473]"}`}>
              {client.overdue ? naira(Number(client.due_now)) : "—"}
            </div>
            {client.overdue && client.next_due_label && <div className="mt-0.5 text-xs text-[#8b95a7]">next: {client.next_due_label}</div>}
          </div>
        </div>
      </section>

      {/* Their houses, each with the client-facing milestone strip */}
      {houseList.length > 0 && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Their house{houseList.length > 1 ? "s" : ""}</h2>
          <div className="mt-4 space-y-5">
            {houseList.map((h) => {
              const ms = [
                ...(msByBld.get(h.id) ?? []).sort((a, b) => a.milestone_order - b.milestone_order),
                { building_id: h.id, milestone: "Handover", milestone_order: 9999, status: h.status === "done" ? "done" : "not_started" },
              ];
              return (
                <div key={h.id}>
                  <div className="flex items-baseline justify-between">
                    <Link href={`/buildings/${h.id}`} className="text-sm font-medium text-white hover:text-accent-300">{h.code}</Link>
                    <span className="text-xs text-[#8b95a7]">{ms.filter((x) => x.status === "done").length}/{ms.length} milestones</span>
                  </div>
                  <div className="mt-2 flex items-start gap-1 overflow-x-auto pb-1">
                    {ms.map((m, i) => (
                      <div key={m.milestone} className="flex items-center gap-1">
                        <div className="flex min-w-[72px] flex-col items-center gap-1.5 px-1">
                          <span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${
                            m.status === "done" ? "bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/40"
                            : m.status === "in_progress" ? "bg-accent-500/20 text-accent-300 ring-1 ring-accent-400/50 shadow-glow"
                            : "bg-white/[0.04] text-[#5b6473] ring-1 ring-white/[0.08]"}`}>
                            {m.status === "done" ? "✓" : i + 1}
                          </span>
                          <span className={`text-center text-[10px] leading-tight ${m.status === "not_started" ? "text-[#5b6473]" : "text-[#c7cedb]"}`}>{m.milestone}</span>
                        </div>
                        {i < ms.length - 1 && <span className={`mt-3.5 h-0.5 w-4 shrink-0 rounded ${m.status === "done" ? "bg-emerald-400/40" : "bg-white/[0.08]"}`} />}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Payment schedules per sale */}
      {sales.map((s) => {
        const sum = sps.get(s.id);
        const rows = tranches.filter((t) => t.sale_id === s.id);
        const scope = s.building_id ? (bldOf.get(s.building_id)?.code ?? "house") : "whole project";
        const payBadge = (st: string) => (st === "paid" ? "badge-green" : st === "part" ? "badge-accent" : "badge-muted");
        return (
          <section key={s.id} className="card p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-5">
              <h2 className="text-sm font-semibold text-white">
                {s.party_role === "partner" ? "Partnership" : "Purchase"} · {scope}
                {sum && <span className="ml-2 font-mono text-xs text-[#8b95a7]">{naira(Number(sum.paid))} / {naira(Number(sum.total_amount))} paid</span>}
              </h2>
              <Link href={`/sales/${s.id}`} className="btn btn-ghost px-2.5 py-1 text-xs">Open sale · record payment</Link>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base min-w-[560px]">
                <thead><tr><th>Tranche</th><th className="text-right">Amount</th><th>Status</th><th className="text-right">Due now?</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.seq}>
                      <td className="font-medium text-white">{t.label}</td>
                      <td className="text-right font-mono">{naira(Number(t.amount))}</td>
                      <td><span className={`badge ${payBadge(t.pay_status)}`}>{t.pay_status}</span></td>
                      <td className="text-right">{t.is_due && t.pay_status !== "paid" ? <span className="badge badge-accent">due</span> : <span className="text-xs text-[#5b6473]">{t.pay_status === "paid" ? "settled" : "upcoming"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {sales.length === 0 && (
        <section className="card">
          <p className="text-sm text-[#8b95a7]">No sales yet — record one on the <Link href="/sales" className="text-accent-300 hover:underline">Sales page</Link> and pick this client.</p>
        </section>
      )}

      {/* Portal access */}
      <section className="card">
        <h2 className="text-sm font-semibold text-white">Client portal</h2>
        <p className="mt-0.5 text-xs text-[#8b95a7]">Their read-only, PIN-protected window — progress and payments, never prices or suppliers.</p>
        {links.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {links.map((l) => {
              const st = linkStatus(l);
              return (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white/[0.03] px-3 py-2 text-sm">
                  <span className="text-[#c7cedb]">{l.link_type === "buyer" ? `buyer · ${l.building_id ? (bldOf.get(l.building_id)?.code ?? "house") : "house"}` : "partner · project"}</span>
                  <span className="text-xs text-[#8b95a7]">last opened: {lastOpened.get(l.id) ? new Date(lastOpened.get(l.id)!).toLocaleString() : "never"}</span>
                  <span className={`badge ${statusBadge(st)}`}>{st}</span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-4">
          {projectId ? (
            <SendPortalLink projectId={projectId} clientId={client.client_id} clientName={client.full_name}
              clientEmail={client.email} clientPhone={client.phone} buildings={houseList.map((h) => ({ id: h.id, code: h.code }))} />
          ) : (
            <p className="text-xs text-[#8b95a7]">Create a project first to share a portal link.</p>
          )}
        </div>
        <p className="mt-3 text-xs text-[#5b6473]">Revoke links from the <Link href="/portal-links" className="text-accent-300 hover:underline">Portal links</Link> page.</p>
      </section>
    </div>
  );
}
