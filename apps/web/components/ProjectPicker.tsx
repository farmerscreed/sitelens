"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconBuilding, IconChevron } from "@/components/icons";

type Project = { id: string; name: string };

// Client-side project switcher: changes the `?project=` query param and navigates.
// (A server component may NOT pass an onChange handler to a <select> — that was the
// 500 "Event handlers cannot be passed to Client Component props".)
export function ProjectPicker({ projects, value }: { projects: Project[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function onChange(id: string) {
    const next = new URLSearchParams(params.toString());
    next.set("project", id);
    router.push(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="relative flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] pl-3 pr-1.5 py-1.5">
      <IconBuilding className="h-4 w-4 text-[#8b95a7]" />
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={projects.length === 0}
        className="max-w-[12rem] cursor-pointer appearance-none truncate bg-transparent pr-5 text-sm font-medium text-white focus:outline-none disabled:opacity-60"
      >
        {projects.length === 0 && <option value="">No projects</option>}
        {projects.map((p) => (
          <option key={p.id} value={p.id} className="bg-ink-850 text-white">
            {p.name}
          </option>
        ))}
      </select>
      <IconChevron className="pointer-events-none -ml-4 h-4 w-4 text-[#8b95a7]" />
    </div>
  );
}
