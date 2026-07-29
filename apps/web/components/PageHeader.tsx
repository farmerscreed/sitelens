"use client";
import { useState } from "react";
import { IconInfo, IconClose } from "@/components/icons";

type Info = { what: string; steps?: string[] };

// Consistent page header: title, subtitle, optional (i) help panel, right-aligned actions.
// The (i) button toggles an inline explainer so users know what the page is and what to do.
export function PageHeader({
  title, subtitle, info, children,
}: {
  title: string;
  subtitle?: string;
  info?: Info;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
            {info && (
              <button onClick={() => setOpen((o) => !o)}
                aria-label="What is this page?" title="What is this page?"
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg border transition ${
                  open ? "border-accent-500/40 bg-accent-500/10 text-accent-300"
                       : "border-white/[0.08] bg-white/[0.02] text-[#8b95a7] hover:text-white"}`}>
                <IconInfo className="h-4 w-4" />
              </button>
            )}
          </div>
          {subtitle && <p className="mt-1 max-w-2xl text-sm text-[#8b95a7]">{subtitle}</p>}
        </div>
        {children && <div className="flex shrink-0 items-center gap-2 sm:gap-3">{children}</div>}
      </div>

      {info && open && (
        <div className="mt-4 animate-fade-up rounded-2xl border border-accent-500/20 bg-accent-500/[0.04] p-5">
          <div className="flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed text-[#d4dae4]">{info.what}</p>
            <button onClick={() => setOpen(false)} aria-label="Close"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-[#8b95a7] transition hover:bg-white/[0.06] hover:text-white">
              <IconClose className="h-4 w-4" />
            </button>
          </div>
          {info.steps && info.steps.length > 0 && (
            <ol className="mt-4 space-y-2">
              {info.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-sm text-[#c7cedb]">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-500/15 text-[11px] font-semibold text-accent-300">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </header>
  );
}
