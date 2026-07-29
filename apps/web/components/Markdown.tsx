import { Fragment } from "react";

// Minimal, dependency-free markdown renderer for AI answers. Handles headings,
// bullet/numbered lists, bold/italic/inline-code, and paragraphs — enough to make
// model output read cleanly without pulling in an external library (CSP-safe).

function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Split on **bold**, *italic*, `code` while keeping delimiters.
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) nodes.push(<strong key={`${keyBase}-b${i}`} className="font-semibold text-white">{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={`${keyBase}-c${i}`} className="rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[13px] text-accent-200">{tok.slice(1, -1)}</code>);
    else nodes.push(<em key={`${keyBase}-i${i}`} className="italic text-[#d4dae4]">{tok.slice(1, -1)}</em>);
    last = m.index + tok.length; i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, `li${key}-${i}`)}</li>);
    blocks.push(list.ordered
      ? <ol key={key++} className="ml-1 list-decimal space-y-1.5 pl-5 marker:text-accent-400">{items}</ol>
      : <ul key={key++} className="ml-1 list-disc space-y-1.5 pl-5 marker:text-accent-400">{items}</ul>);
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    const num = /^\d+[.)]\s+(.*)$/.exec(line);

    if (h) {
      flush();
      const size = h[1].length === 1 ? "text-base" : "text-sm";
      blocks.push(<p key={key++} className={`mt-1 font-semibold text-white ${size}`}>{inline(h[2], `h${key}`)}</p>);
    } else if (bullet) {
      if (!list || list.ordered) { flush(); list = { ordered: false, items: [] }; }
      list.items.push(bullet[1]);
    } else if (num) {
      if (!list || !list.ordered) { flush(); list = { ordered: true, items: [] }; }
      list.items.push(num[1]);
    } else {
      flush();
      blocks.push(<p key={key++} className="leading-relaxed">{inline(line, `p${key}`)}</p>);
    }
  }
  flush();

  return <div className="space-y-2.5 text-sm text-[#e8ecf3]">{blocks.map((b, i) => <Fragment key={i}>{b}</Fragment>)}</div>;
}
