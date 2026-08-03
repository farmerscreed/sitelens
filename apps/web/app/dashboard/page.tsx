import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  IconBoard, IconCalendar, IconBox, IconReceipt, IconLayers, IconUpload,
  IconChat, IconBuilding, IconLink, IconCheck, IconChevron, IconUsers,
} from "@/components/icons";

type Org = { org_id: string; org_name: string; role: string; is_active_org: boolean };
const naira = (n: number) => "₦" + Math.round(Number(n)).toLocaleString();
const nairaShort = (n: number) => {
  const v = Number(n);
  if (v >= 1e9) return "₦" + (v / 1e9).toFixed(1) + "b";
  if (v >= 1e6) return "₦" + Math.round(v / 1e6) + "m";
  if (v >= 1e3) return "₦" + Math.round(v / 1e3) + "k";
  return "₦" + Math.round(v);
};

export default async function Dashboard() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: orgs } = await supabase.rpc("fn_my_orgs");
  const active = ((orgs as Org[]) ?? []).find((o) => o.is_active_org);

  const [
    { data: projectRows }, { data: buildingRows }, { data: recipeRows },
    { data: portalRows }, { data: saleRows }, { data: msRows }, { data: txnRows }, { data: priceRows },
    { data: clientRows },
  ] = await Promise.all([
    supabase.from("projects").select("id").is("archived_at", null),
    supabase.from("buildings").select("id,status").is("archived_at", null),
    supabase.from("building_types").select("id").is("archived_at", null),
    supabase.from("portal_links").select("id").is("revoked_at", null),
    supabase.from("sale_payment_summary").select("party_role,total_amount,paid"),
    supabase.from("building_milestones").select("milestone,milestone_order,status,building_id"),
    supabase.from("material_transactions").select("id").limit(1),
    supabase.from("material_prices").select("id").limit(1),
    supabase.from("client_summary").select("client_id,full_name,due_now,next_due_label,overdue").order("due_now", { ascending: false }),
  ]);

  const buildings = buildingRows ?? [];
  const buildingsDone = buildings.filter((b) => b.status === "done").length;
  const pct = buildings.length ? Math.round((buildingsDone / buildings.length) * 100) : 0;

  const sales = (saleRows ?? []) as { party_role: string; total_amount: string; paid: string }[];
  const buyerSales = sales.filter((s) => s.party_role === "buyer");
  const contractValue = buyerSales.reduce((a, s) => a + Number(s.total_amount), 0);
  const collected = sales.reduce((a, s) => a + Number(s.paid), 0);

  // Collections: tranches that are triggered (milestone reached / month arrived)
  // but unpaid — the money to go and collect today.
  type ClientDue = { client_id: string; full_name: string; due_now: string; next_due_label: string | null; overdue: boolean };
  const overdueClients = ((clientRows ?? []) as ClientDue[]).filter((c) => c.overdue);
  const dueNow = overdueClients.reduce((a, c) => a + Number(c.due_now), 0);

  // Portfolio by milestone (across all live buildings).
  type Ms = { milestone: string; milestone_order: number; status: string; building_id: string };
  const byMs = new Map<string, { order: number; reached: number; total: Set<string> }>();
  for (const m of (msRows ?? []) as Ms[]) {
    if (m.milestone === "Other") continue;
    if (!byMs.has(m.milestone)) byMs.set(m.milestone, { order: m.milestone_order, reached: 0, total: new Set() });
    const g = byMs.get(m.milestone)!;
    g.total.add(m.building_id);
    if (m.status === "done") g.reached++;
  }
  const portfolio = [...byMs.entries()]
    .map(([milestone, g]) => ({ milestone, order: g.order, reached: g.reached, total: g.total.size }))
    .sort((a, b) => a.order - b.order);

  const stats = [
    { label: "Projects", value: (projectRows ?? []).length.toLocaleString(), icon: IconBuilding, href: "/projects" },
    { label: "Homes", value: buildings.length.toLocaleString(), icon: IconBoard, href: "/board" },
    { label: "Homes sold", value: buyerSales.length.toLocaleString(), icon: IconReceipt, href: "/sales" },
    { label: "Collected", value: nairaShort(collected), icon: IconLink, href: "/sales" },
  ];

  const launch = [
    { href: "/board", label: "Board", desc: "Homes by stage", icon: IconBoard },
    { href: "/clients", label: "Clients", desc: "Directory & collections", icon: IconUsers },
    { href: "/sales", label: "Sales & payments", desc: "Buyers, partners, payment plans", icon: IconReceipt },
    { href: "/planner", label: "Planner", desc: "Cash-flow feasibility", icon: IconCalendar },
    { href: "/materials", label: "Materials", desc: "Stock & reorder", icon: IconBox },
    { href: "/portal-links", label: "Client portals", desc: "Share progress links", icon: IconLink },
    { href: "/ask", label: "Ask", desc: "Query your site data", icon: IconChat },
  ];

  const setup = [
    { done: (recipeRows ?? []).length > 0, label: "Create a building recipe", desc: "Stages + material quantities", href: "/recipes" },
    { done: (priceRows ?? []).length > 0, label: "Set material prices", desc: "Dated market prices", href: "/prices" },
    { done: buildings.length > 0, label: "Add homes to the board", desc: "Stamp from a recipe", href: "/board" },
    { done: buyerSales.length > 0, label: "Record a sale", desc: "Buyer or partner + payment plan", href: "/sales" },
    { done: (portalRows ?? []).length > 0, label: "Share a client portal", desc: "Buyer or partner view", href: "/portal-links" },
  ];
  const doneCount = setup.filter((s) => s.done).length;
  const allDone = doneCount === setup.length;

  return (
    <div className="space-y-8">
      {/* Hero — portfolio at a glance */}
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-ink-800/80 to-ink-900/40 p-6 shadow-panel sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-accent-500/20 blur-3xl" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.15] [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:32px_32px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-300">Command Console</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">{active ? active.org_name : "SiteLens"}</h1>
            <p className="mt-1.5 text-sm text-[#8b95a7]">
              Signed in as {userRes.user.email ?? userRes.user.phone}{active && <> · <span className="text-[#c7cedb]">{active.role}</span></>}
            </p>
            <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-sm">
              <span className="text-[#8b95a7]">Contract value <span className="ml-1 font-mono text-white">{naira(contractValue)}</span></span>
              <span className="text-[#8b95a7]">Collected <span className="ml-1 font-mono text-emerald-300">{naira(collected)}</span></span>
              {dueNow > 0 && (
                <Link href="/clients" className="text-[#8b95a7] hover:text-white">Due now <span className="ml-1 font-mono text-accent-300">{naira(dueNow)}</span></Link>
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="stat-label">Portfolio complete</div>
            <div className="mt-1 font-mono text-4xl font-semibold text-white sm:text-5xl">{pct}<span className="text-2xl text-accent-300">%</span></div>
            <div className="mt-1 text-xs text-[#8b95a7]">{buildingsDone} of {buildings.length} homes</div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.label} href={s.href} className="stat card-hover group">
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-accent-500/[0.07] blur-2xl transition group-hover:bg-accent-500/15" />
              <div className="flex items-center justify-between">
                <span className="stat-label">{s.label}</span>
                <Icon className="h-5 w-5 text-accent-400/80" />
              </div>
              <div className="stat-value">{s.value}</div>
            </Link>
          );
        })}
      </section>

      {/* Collections — who to call today. Disappears when nothing is due. */}
      {overdueClients.length > 0 && (
        <section className="card border-accent-500/25">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Collections</h2>
              <p className="mt-0.5 text-xs text-[#8b95a7]">Tranches that are due (milestone reached or month arrived) and not yet paid.</p>
            </div>
            <span className="badge badge-accent font-mono">{naira(dueNow)} due now</span>
          </div>
          <div className="mt-3 space-y-1.5">
            {overdueClients.slice(0, 5).map((c) => (
              <Link key={c.client_id} href={`/clients/${c.client_id}`}
                className="group flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.03]">
                <span className="min-w-0 truncate text-sm font-medium text-white">{c.full_name}
                  {c.next_due_label && <span className="ml-2 text-xs text-[#5b6473]">next: {c.next_due_label}</span>}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm text-accent-300">{naira(Number(c.due_now))}</span>
                  <IconChevron className="h-4 w-4 -rotate-90 text-[#5b6473] transition group-hover:text-accent-300" />
                </span>
              </Link>
            ))}
            {overdueClients.length > 5 && (
              <Link href="/clients" className="block px-2 pt-1 text-xs text-accent-300 hover:underline">
                +{overdueClients.length - 5} more on the clients page →
              </Link>
            )}
          </div>
        </section>
      )}

      {/* Portfolio by milestone */}
      {portfolio.length > 0 && (
        <section className="card">
          <h2 className="text-sm font-semibold text-white">Portfolio by milestone</h2>
          <p className="mt-0.5 text-xs text-[#8b95a7]">Homes that have reached each stage across every project.</p>
          <div className="mt-4 space-y-2.5">
            {portfolio.map((m) => (
              <div key={m.milestone}>
                <div className="flex items-center justify-between text-sm"><span className="text-[#c7cedb]">{m.milestone}</span><span className="font-mono text-[#8b95a7]">{m.reached}/{m.total}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]"><div className="h-full rounded-full bg-accent-sheen" style={{ width: `${m.total ? (m.reached / m.total) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Getting started */}
      {!allDone && (
        <section className="card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-white">Getting started</h2>
              <p className="mt-0.5 text-xs text-[#8b95a7]">Set these up once and the whole console comes alive.</p>
            </div>
            <span className="badge badge-accent">{doneCount} / {setup.length} done</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
            <div className="h-full rounded-full bg-accent-sheen transition-all" style={{ width: `${(doneCount / setup.length) * 100}%` }} />
          </div>
          <div className="mt-4 space-y-1.5">
            {setup.map((s) => (
              <Link key={s.href} href={s.href} className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.03]">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${s.done ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-white/15 text-[#5b6473]"}`}>
                  {s.done ? <IconCheck className="h-3.5 w-3.5" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-sm font-medium ${s.done ? "text-[#8b95a7] line-through" : "text-white"}`}>{s.label}</span>
                  <span className="block truncate text-xs text-[#5b6473]">{s.desc}</span>
                </span>
                <IconChevron className="h-4 w-4 -rotate-90 text-[#5b6473] transition group-hover:text-accent-300" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Quick launch */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#8b95a7]">Quick launch</h2>
        <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {launch.map((l) => {
            const Icon = l.icon;
            return (
              <Link key={l.href} href={l.href} className="card card-hover group flex items-center gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-accent-300 transition group-hover:border-accent-500/40 group-hover:text-accent-200">
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-white">{l.label}</span>
                  <span className="block truncate text-xs text-[#8b95a7]">{l.desc}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
