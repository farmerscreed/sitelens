"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Project = { id: string; name: string };

export function AskBox({ projects }: { projects: Project[] }) {
  const supabase = createClient();
  const [project, setProject] = useState(projects[0]?.id ?? "");
  const [q, setQ] = useState("Which material should I reorder, and how much?");
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
    <div className="max-w-2xl space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <select className="rounded border px-2 py-1 dark:bg-neutral-900" value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <textarea className="w-full rounded-md border border-neutral-300 px-3 py-2 dark:border-neutral-700 dark:bg-neutral-900"
        rows={3} value={q} onChange={(e) => setQ(e.target.value)} />
      <button className="rounded-md bg-neutral-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        onClick={ask} disabled={busy || !project || !q}>{busy ? "Thinking…" : "Ask"}</button>
      {answer && <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">{answer}</div>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  );
}
