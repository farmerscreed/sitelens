"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Markdown } from "@/components/Markdown";
import { IconChat, IconAlert, IconSpark } from "@/components/icons";

type Project = { id: string; name: string };

const SUGGESTIONS = [
  "Which material should I reorder, and how much?",
  "How much have we spent so far this month?",
  "Which buildings are behind schedule?",
];

export function AskBox({ projects }: { projects: Project[] }) {
  const supabase = createClient();
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [q, setQ] = useState(SUGGESTIONS[0]);
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function ask() {
    setBusy(true); setErr(null); setAnswer(null);
    const { data, error } = await supabase.functions.invoke("ask", { body: { question: q, projectId: project } });
    setBusy(false);
    if (error) setErr(error.message);
    else setAnswer(data.answer);
  }

  return (
    <div className="max-w-2xl space-y-4">
      <section className="card">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <label className="label">Project</label>
            <select className="select" value={project} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <label className="label">Your question</label>
          <textarea className="textarea" rows={3} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about this project…" />
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => setQ(s)}
              className="rounded-full border border-white/[0.08] bg-white/[0.02] px-3 py-1 text-xs text-[#8b95a7] transition hover:border-accent-500/30 hover:text-white">
              {s}
            </button>
          ))}
        </div>
        <button className="btn btn-primary mt-4" onClick={ask} disabled={busy || !project || !q}>
          <IconChat className="h-4 w-4" />{busy ? "Thinking…" : "Ask"}
        </button>
      </section>

      {answer && (
        <section className="card border-accent-500/20 bg-accent-500/[0.03]">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent-300">
            <IconSpark className="h-4 w-4" /> Answer
          </h3>
          <Markdown text={answer} />
        </section>
      )}
      {err && <p className="flex items-center gap-1.5 text-sm text-red-300"><IconAlert className="h-4 w-4" />{err}</p>}
    </div>
  );
}
