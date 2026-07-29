import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  IconBoard, IconCalendar, IconBox, IconReceipt, IconLayers, IconUpload,
  IconChat, IconBuilding, IconLink, IconCheck, IconChevron,
} from "@/components/icons";

type Org = { org_id: string; org_name: string; role: string; is_active_org: boolean };

export default async function Dashboard() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: orgs } = await supabase.rpc("fn_my_orgs");
  const active = ((orgs as Org[]) ?? []).find((o) => o.is_active_org);

  // Live counts (RLS-scoped SELECTs — read-only, safe).
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c ?? 0;
  };
  const [projects, buildings, recipes, portals, prices, txns] = await Promise.all([
    count("projects"),
    count("buildings"),
    count("building_types", (q) => q.is("archived_at", null)),
    count("portal_links", (q) => q.is("revoked_at", null)),
    count("material_prices"),
    count("material_transactions"),
  ]);

  const stats = [
    { label: "Projects", value: projects, icon: IconBuilding, href: "/projects" },
    { label: "Buildings", value: buildings, icon: IconBoard, href: "/board" },
    { label: "Recipes", value: recipes, icon: IconLayers, href: "/recipes" },
    { label: "Active portals", value: portals, icon: IconLink, href: "/portal-links" },
  ];

  const launch = [
    { href: "/board", label: "Board", desc: "Buildings by stage", icon: IconBoard },
    { href: "/planner", label: "Planner", desc: "Schedule & feasibility", icon: IconCalendar },
    { href: "/materials", label: "Materials", desc: "Stock & reorder advice", icon: IconBox },
    { href: "/expenses", label: "Expenses", desc: "Spend vs budget", icon: IconReceipt },
    { href: "/boq-import", label: "BOQ import", desc: "Extract from PDF", icon: IconUpload },
    { href: "/ask", label: "Ask", desc: "Query your site data", icon: IconChat },
  ];

  // Adaptive getting-started checklist — reflects real progress.
  const setup = [
    { done: recipes > 0, label: "Create a building recipe", desc: "Stages + material quantities", href: "/recipes" },
    { done: prices > 0, label: "Set material prices", desc: "Dated market prices", href: "/prices" },
    { done: buildings > 0, label: "Add buildings to the board", desc: "Stamp from a recipe", href: "/board" },
    { done: txns > 0, label: "Log your stock", desc: "Deliveries in, usage out", href: "/materials" },
    { done: portals > 0, label: "Share a client portal", desc: "Read-only progress link", href: "/portal-links" },
  ];
  const doneCount = setup.filter((s) => s.done).length;
  const allDone = doneCount === setup.length;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-ink-800/80 to-ink-900/40 p-6 shadow-panel sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl" />
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-300">Command Console</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
          {active ? active.org_name : "SiteLens"}
        </h1>
        <p className="mt-1.5 text-sm text-[#8b95a7]">
          Signed in as {userRes.user.email ?? userRes.user.phone}
          {active && <> · <span className="text-[#c7cedb]">{active.role}</span></>}
        </p>
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
              <div className="stat-value">{s.value.toLocaleString()}</div>
            </Link>
          );
        })}
      </section>

      {/* Getting started — adaptive; hides once everything's done */}
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
              <Link key={s.href} href={s.href}
                className="group flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-white/[0.03]">
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
                  s.done ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                         : "border-white/15 text-[#5b6473]"}`}>
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
