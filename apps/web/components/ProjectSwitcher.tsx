"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconBuilding, IconChevron } from "@/components/icons";

type Project = { id: string; name: string };

// Routes whose data is scoped to a single project → show the switcher there.
const SCOPED = ["/board", "/materials", "/expenses", "/portal-links"];
const COOKIE = "sl_project";

function readCookie(name: string): string | undefined {
  return document.cookie.split("; ").find((c) => c.startsWith(name + "="))?.split("=")[1];
}
function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export function ProjectSwitcher() {
  const pathname = usePathname() || "";
  const router = useRouter();
  const supabase = createClient();
  const [projects, setProjects] = useState<Project[]>([]);
  const [value, setValue] = useState<string>("");

  const scoped = SCOPED.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (!scoped) return;
    let live = true;
    (async () => {
      const { data } = await supabase
        .from("projects").select("id,name").is("archived_at", null).order("name");
      if (!live || !data) return;
      setProjects(data);
      const cookie = readCookie(COOKIE);
      const initial = data.find((p) => p.id === cookie)?.id ?? data[0]?.id ?? "";
      setValue(initial);
      if (initial && initial !== cookie) writeCookie(COOKIE, initial);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, pathname]);

  if (!scoped || projects.length === 0) return null;

  function onChange(id: string) {
    setValue(id);
    writeCookie(COOKIE, id);
    router.refresh();
  }

  return (
    <div className="relative flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] pl-3 pr-1.5 py-1.5">
      <IconBuilding className="h-4 w-4 text-[#8b95a7]" />
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="max-w-[10rem] cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-medium text-white focus:outline-none">
        {projects.map((p) => (
          <option key={p.id} value={p.id} className="bg-ink-850 text-white">{p.name}</option>
        ))}
      </select>
      <IconChevron className="pointer-events-none -ml-4 h-4 w-4 text-[#8b95a7]" />
    </div>
  );
}
