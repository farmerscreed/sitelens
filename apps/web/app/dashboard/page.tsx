import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  IconBoard, IconCalendar, IconBox, IconReceipt, IconLayers, IconUpload,
  IconChat, IconBuilding, IconLink, IconCheck,
} from "@/components/icons";

// Decode the (already-trusted) session JWT just to SHOW the active_org_id claim
// the A0 hook injected — a reassuring "isolation is on" status line.
function decodeClaims(jwt: string): Record<string, unknown> {
  try {
    const [, payload] = jwt.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return {};
  }
}

type Org = { org_id: string; org_name: string; role: string; is_active_org: boolean };

export default async function Dashboard() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");

  const { data: sessionRes } = await supabase.auth.getSession();
  const claims = sessionRes.session ? decodeClaims(sessionRes.session.access_token) : {};
  const { data: orgs } = await supabase.rpc("fn_my_orgs");
  const active = ((orgs as Org[]) ?? []).find((o) => o.is_active_org);

  // Live counts (RLS-scoped SELECTs — read-only, safe).
  const count = async (table: string, filter?: (q: any) => any) => {
    let q = supabase.from(table).select("id", { count: "exact", head: true });
    if (filter) q = filter(q);
    const { count: c } = await q;
    return c ?? 0;
  };
  const [projects, buildings, recipes, portals] = await Promise.all([
    count("projects"),
    count("buildings"),
    count("building_types", (q) => q.is("archived_at", null)),
    count("portal_links", (q) => q.is("revoked_at", null)),
  ]);

  const stats = [
    { label: "Projects", value: projects, icon: IconBuilding, href: "/board" },
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

  const hookOn = Boolean(claims.active_org_id);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-ink-800/80 to-ink-900/40 p-7 shadow-panel">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-accent-500/20 blur-3xl" />
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-300">Command Console</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">
          {active ? active.org_name : "SiteLens"}
        </h1>
        <p className="mt-1.5 text-sm text-[#8b95a7]">
          Signed in as {userRes.user.email ?? userRes.user.phone}
          {active && <> · <span className="text-[#c7cedb]">{active.role}</span></>}
        </p>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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

      {/* Quick launch */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[#8b95a7]">Quick launch</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

      {/* System status */}
      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Tenant isolation</h2>
          <span className={`badge ${hookOn ? "badge-green" : "badge-red"}`}>
            {hookOn ? <><IconCheck className="h-3.5 w-3.5" /> Active</> : "Not detected"}
          </span>
        </div>
        <p className="mt-1.5 text-xs text-[#8b95a7]">
          Every query is gated by <code className="text-[#c7cedb]">active_org_id</code> from your signed token — the console
          can only ever see this organisation&apos;s data.
        </p>
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {[
            ["active_org_id", claims.active_org_id],
            ["user_role", claims.user_role],
            ["membership_id", claims.membership_id],
          ].map(([k, v]) => (
            <div key={k as string} className="flex items-center justify-between gap-3 border-b border-white/[0.05] pb-2">
              <dt className="text-[#8b95a7]">{k as string}</dt>
              <dd className="truncate font-mono text-xs text-[#c7cedb]">{String(v ?? "—")}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
