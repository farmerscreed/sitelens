"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { IconBuilding, IconCheck, IconAlert, IconClose } from "@/components/icons";

type Project = {
  id: string; name: string; location_text: string | null; status: string | null;
  total_budget: string | number | null; start_date: string | null;
  target_end_date: string | null; archived_at: string | null;
};

const COOKIE = "sl_project";
function writeCookie(v: string) {
  document.cookie = `${COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
}
const naira = (n?: string | number | null) =>
  n == null || n === "" ? "—" : "₦" + Math.round(Number(n)).toLocaleString();

export function ProjectsManager({ projects, activeId }: { projects: Project[]; activeId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  // create form
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [budget, setBudget] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  async function create() {
    setBusy(true); setErr(null);
    const id = crypto.randomUUID();
    const { error } = await supabase.rpc("fn_create_project", {
      p_id: id, p_name: name, p_location: location || null,
      p_budget: budget ? Number(budget) : null,
      p_start: start || null, p_target_end: end || null,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    writeCookie(id); // make the new project active
    setName(""); setLocation(""); setBudget(""); setStart(""); setEnd("");
    router.refresh();
  }

  async function rename(id: string) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_rename_project", { p_project: id, p_name: renameVal });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setRenaming(null); router.refresh();
  }

  async function archive(id: string, archive: boolean) {
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("fn_archive_project", { p_project: id, p_archive: archive });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.refresh();
  }

  function setActive(id: string) {
    writeCookie(id);
    router.refresh();
  }

  const active = projects.filter((p) => !p.archived_at);
  const archived = projects.filter((p) => p.archived_at);

  return (
    <div className="space-y-6">
      {err && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3.5 py-2.5 text-sm text-red-300">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{err}</span>
        </div>
      )}

      {/* Active projects */}
      <div className="grid gap-3 sm:grid-cols-2">
        {active.map((p) => {
          const isActive = p.id === activeId;
          return (
            <div key={p.id} className={`card ${isActive ? "border-accent-500/40 shadow-glow" : ""}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.03] text-accent-300">
                    <IconBuilding className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    {renaming === p.id ? (
                      <div className="flex items-center gap-1.5">
                        <input className="input py-1" value={renameVal} autoFocus
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && rename(p.id)} />
                        <button className="btn btn-ghost px-2 py-1" onClick={() => rename(p.id)} disabled={busy}><IconCheck className="h-4 w-4" /></button>
                        <button className="btn btn-ghost px-2 py-1" onClick={() => setRenaming(null)}><IconClose className="h-4 w-4" /></button>
                      </div>
                    ) : (
                      <>
                        <p className="truncate font-semibold text-white">{p.name}</p>
                        <p className="truncate text-xs text-[#8b95a7]">{p.location_text || "No location set"}</p>
                      </>
                    )}
                  </div>
                </div>
                {isActive && <span className="badge badge-accent shrink-0">active</span>}
              </div>

              <dl className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <div><dt className="text-[#5b6473]">Budget</dt><dd className="mt-0.5 font-mono text-[#c7cedb]">{naira(p.total_budget)}</dd></div>
                <div><dt className="text-[#5b6473]">Start</dt><dd className="mt-0.5 font-mono text-[#c7cedb]">{p.start_date ?? "—"}</dd></div>
                <div><dt className="text-[#5b6473]">Target</dt><dd className="mt-0.5 font-mono text-[#c7cedb]">{p.target_end_date ?? "—"}</dd></div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2">
                {!isActive && <button className="btn btn-primary px-3 py-1.5 text-xs" onClick={() => setActive(p.id)}>Set active</button>}
                <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => { setRenaming(p.id); setRenameVal(p.name); }}>Rename</button>
                <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => archive(p.id, true)} disabled={busy}>Archive</button>
              </div>
            </div>
          );
        })}
        {active.length === 0 && <p className="card text-sm text-[#8b95a7] sm:col-span-2">No active projects — create your first below.</p>}
      </div>

      {/* Create */}
      <section className="card max-w-3xl">
        <h2 className="text-sm font-semibold text-white">New project</h2>
        <p className="mt-1 text-xs text-[#8b95a7]">Creates an isolated project under your organisation. Admin / PM only.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">Project name *</label>
            <input className="input" placeholder="e.g. Lekki Phase 2 Duplexes" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Location</label>
            <input className="input" placeholder="Town / area" value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <div>
            <label className="label">Total budget (₦)</label>
            <input type="number" min="0" className="input" placeholder="0" value={budget} onChange={(e) => setBudget(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label">Start</label><input type="date" className="input" value={start} onChange={(e) => setStart(e.target.value)} /></div>
            <div><label className="label">Target end</label><input type="date" className="input" value={end} onChange={(e) => setEnd(e.target.value)} /></div>
          </div>
        </div>
        <button className="btn btn-primary mt-4" onClick={create} disabled={busy || !name.trim()}>
          {busy ? "Creating…" : "Create project"}
        </button>
      </section>

      {/* Archived */}
      {archived.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-[#8b95a7]">Archived</h2>
          <div className="space-y-2">
            {archived.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-2.5">
                <span className="text-sm text-[#8b95a7]">{p.name}</span>
                <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => archive(p.id, false)} disabled={busy}>Restore</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
