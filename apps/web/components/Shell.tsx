"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ProjectSwitcher } from "@/components/ProjectSwitcher";
import {
  IconGrid, IconBoard, IconCalendar, IconBox, IconReceipt, IconTag, IconLayers,
  IconUpload, IconSpark, IconChat, IconLink, IconBell, IconLogo, IconMenu,
  IconClose, IconLogout, IconChevron, IconBuilding,
} from "@/components/icons";

type NavItem = { href: string; label: string; icon: (p: { className?: string }) => JSX.Element; group: string };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: IconGrid, group: "Command" },
  { href: "/projects", label: "Projects", icon: IconBuilding, group: "Command" },
  { href: "/board", label: "Board", icon: IconBoard, group: "Command" },
  { href: "/planner", label: "Planner", icon: IconCalendar, group: "Command" },
  { href: "/materials", label: "Materials", icon: IconBox, group: "Site" },
  { href: "/expenses", label: "Expenses", icon: IconReceipt, group: "Site" },
  { href: "/prices", label: "Price list", icon: IconTag, group: "Site" },
  { href: "/recipes", label: "Recipes", icon: IconLayers, group: "Design" },
  { href: "/boq-import", label: "BOQ import", icon: IconUpload, group: "Design" },
  { href: "/ask", label: "Ask", icon: IconChat, group: "Intelligence" },
  { href: "/ai", label: "AI proposals", icon: IconSpark, group: "Intelligence" },
  { href: "/portal-links", label: "Portal links", icon: IconLink, group: "Clients" },
  { href: "/notifications", label: "Notifications", icon: IconBell, group: "Clients" },
];

type Org = { org_id: string; org_name: string; role: string; is_active_org: boolean };

// Routes rendered without the console chrome (auth + public client portal).
function isBare(path: string) {
  return path === "/login" || path === "/" || path.startsWith("/portal/");
}

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [email, setEmail] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isBare(pathname)) return;
    let live = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (live) setEmail(u.user?.email ?? u.user?.phone ?? "");
      const { data } = await supabase.rpc("fn_my_orgs");
      if (live && data) setOrgs(data as Org[]);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (isBare(pathname)) return <>{children}</>;

  const active = orgs.find((o) => o.is_active_org);
  const current = NAV.find((n) => pathname.startsWith(n.href));
  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  async function switchOrg(orgId: string) {
    if (busy || orgId === active?.org_id) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_set_active_org", { p_org: orgId });
    if (!error) await supabase.auth.refreshSession();
    setBusy(false);
    if (!error) router.refresh();
  }
  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  const SidebarInner = (
    <div className="flex h-full flex-col">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-5 py-5" onClick={() => setOpen(false)}>
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-sheen text-ink-950 shadow-glow">
          <IconLogo className="h-5 w-5" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">
          Site<span className="gradient-text">Lens</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6">
        {groups.map((g) => (
          <div key={g}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#5b6473]">{g}</p>
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === g).map((n) => {
                const on = pathname.startsWith(n.href);
                const Icon = n.icon;
                return (
                  <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                    className={`nav-item ${on ? "nav-item-active" : ""}`}>
                    <Icon className="h-[18px] w-[18px] shrink-0" />
                    {n.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-white/[0.06] p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-xs font-semibold text-accent-300">
            {(email || "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-[#8b95a7]">{email || "—"}</span>
          <button onClick={signOut} title="Sign out"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#8b95a7] transition hover:bg-white/[0.06] hover:text-white">
            <IconLogout className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r border-white/[0.06] bg-ink-900/70 backdrop-blur-xl lg:block">
        {SidebarInner}
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-white/[0.06] bg-ink-900 shadow-lift">
            {SidebarInner}
          </aside>
        </div>
      )}

      {/* Topbar */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-white/[0.06] bg-ink-950/70 px-4 backdrop-blur-xl sm:px-6">
        <button onClick={() => setOpen(true)}
          className="grid h-9 w-9 place-items-center rounded-lg text-[#8b95a7] hover:bg-white/[0.06] hover:text-white lg:hidden">
          <IconMenu />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-white">{current?.label ?? "Console"}</h1>
        </div>

        {/* Project switcher (only on project-scoped routes) */}
        <ProjectSwitcher />

        {/* Org switcher */}
        <div className="relative flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.02] pl-3 pr-1.5 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_0_rgba(52,211,153,0.8)]" />
          <select value={active?.org_id ?? ""} disabled={busy || orgs.length === 0}
            onChange={(e) => switchOrg(e.target.value)}
            className="max-w-[9rem] cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-medium text-white focus:outline-none disabled:opacity-60"
            style={{ backgroundImage: "none" }}>
            {orgs.length === 0 && <option value="">Loading…</option>}
            {orgs.map((o) => (
              <option key={o.org_id} value={o.org_id} className="bg-ink-850 text-white">
                {o.org_name} · {o.role}
              </option>
            ))}
          </select>
          <IconChevron className="pointer-events-none -ml-4 h-4 w-4 text-[#8b95a7]" />
        </div>
      </header>

      {/* Page content */}
      <main className="mx-auto w-full max-w-7xl animate-fade-up px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
