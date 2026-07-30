// AI router (PRD §11.3): all LLM calls go through OpenRouter; model choice is config,
// never hardcoded. DEV_AI_MODE returns canned output so builds/tests never need a paid
// key or hit a rate-limited API (CLAUDE.md local shims).
//
// Deno module shared by edge functions.

export type BoqRow = {
  raw_text: string;
  parsed_qty?: string;
  parsed_unit?: string;
  parsed_rate?: string;
  confidence?: string;
};

const DEV_ROWS: BoqRow[] = [
  { raw_text: "Cement (50kg)", parsed_qty: "320", parsed_unit: "bag", confidence: "0.96" },
  { raw_text: "Sharp sand", parsed_qty: "40", parsed_unit: "ton", confidence: "0.91" },
  { raw_text: "Granite 3/4\"", parsed_qty: "28", parsed_unit: "ton", confidence: "0.90" },
  { raw_text: "Reinforcement Y12", parsed_qty: "1.8", parsed_unit: "ton", confidence: "0.88" },
];

export async function extractBoqFromPdf(pdfBase64: string): Promise<BoqRow[]> {
  const devMode = (Deno.env.get("DEV_AI_MODE") ?? "true") !== "false";
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (devMode || !key) return DEV_ROWS; // canned; no external call

  // Model is config, not code (verify/benchmark per §11.3).
  const model = Deno.env.get("AI_BOQ_MODEL") ?? "anthropic/claude-sonnet-5";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      // PDFs go through the `file` content type (NOT image_url — Claude's image input
      // only accepts jpeg/png/gif/webp). OpenRouter's file-parser routes the document;
      // "native" lets the model read the PDF (tables/layout) directly.
      plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
      messages: [
        {
          role: "system",
          content:
            "Extract the Bill of Quantities as strict JSON: an array of " +
            "{raw_text, parsed_qty, parsed_unit, parsed_rate, confidence}. " +
            "raw_text is the item name exactly as written. Numbers as strings. No prose.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract every BOQ line item from this document. Return only the JSON array." },
            { type: "file", file: { filename: "boq.pdf", file_data: `data:application/pdf;base64,${pdfBase64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "[]";
  const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
  return JSON.parse(json) as BoqRow[];
}

const dev = () => (Deno.env.get("DEV_AI_MODE") ?? "true") !== "false";

// ═══ BOQ extraction v2 (BOQ_TRUE_COST_DESIGN §10) ═══════════════════════════
// The deterministic layer (_shared/boq_core.mjs) classifies structure; the AI
// ENRICHES item rows (kind / stage / material / mix / confidence) and, for
// PDF/photo where there is no grid, extracts rows against the same grammar.

export type BoqV2Row = {
  row_no: number; row_kind: string; raw_text: string;
  boq_ref?: string | null; resolved_text?: string | null;
  qty?: number | null; unit?: string | null; unit_normalized?: string | null;
  rate?: number | null; amount?: number | null;
  is_priced?: boolean; is_provisional?: boolean;
  section_path?: string[]; mix_ratio?: string | null;
  suggested_kind?: string | null; suggested_stage_id?: string | null;
  material_guess?: string | null; flags?: string[];
  confidence?: number | null; field_confidence?: Record<string, number> | null;
};
export type StageRef = { id: string; name: string; sequence: number };

const QS_GRAMMAR = `You are a quantity surveyor reading a Nigerian elemental Bill of
Quantities (SMM/POMI style). Rules you must follow exactly:
- Only measured item rows carry quantities. NEVER take a quantity from narrative
  preambles ("...(grade 25) 16 cubic metre total volume filled into formwork...").
- Notes, information clauses, "To Collection", "TO SUMMARY", page footers and title
  rows are NOT items.
- "Ditto X" inherits the preceding full item's description; resolve it.
- Units are messy (Cu.m=m3, Sq,m=m2, Ttons=t, ltem=item, Nos=nr, L.m=m); normalise.
- A blank rate or "NOT APPLICABLE" means the item is measured but UNPRICED — keep it.
- "PROVISIONAL" zones/items and unit "sum" are provisional.
- kind: material_supply (a purchasable material: sand, rebar, membrane, roofing sheet),
  composite (mixed on site: concrete, blockwork, mortar, render, screed — read the mix
  ratio like "1:2:4" or "(1:6)" when the text states it), labour (clear/excavate/
  remove/compact/protect), plant, provisional, fitting (doors/windows/sanitary),
  other.`;

async function orChat(body: Record<string, unknown>): Promise<string> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
const sliceJson = (t: string, open: string, close: string) =>
  t.slice(t.indexOf(open), t.lastIndexOf(close) + 1);

// Enrich deterministically-annotated ITEM rows, element chunk by element chunk.
// The AI may reclassify item↔note, refine resolved_text, and suggest kind / stage /
// material / mix — it can never invent rows (row_no must exist). Rule 3: all output
// stays a proposal.
export async function enrichBoqRows(
  rows: BoqV2Row[], stages: StageRef[],
): Promise<BoqV2Row[]> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (dev() || !key) return rows; // dev brain already ran in boq_core
  const model = Deno.env.get("AI_BOQ_MODEL") ?? "anthropic/claude-sonnet-5";
  const byElement = new Map<string, BoqV2Row[]>();
  for (const r of rows) {
    if (r.row_kind !== "item" && r.row_kind !== "note") continue;
    const el = r.section_path?.[0] ?? "(front)";
    if (!byElement.has(el)) byElement.set(el, []);
    byElement.get(el)!.push(r);
  }
  const stageList = stages.map((s) => `${s.sequence}. ${s.name}`).join("\n");
  const index = new Map(rows.map((r) => [r.row_no, r]));

  for (const [el, chunk] of byElement) {
    const lines = chunk.map((r) =>
      JSON.stringify({ row_no: r.row_no, kind: r.row_kind, text: r.resolved_text ?? r.raw_text,
        qty: r.qty, unit: r.unit, rate: r.rate })).join("\n");
    const text = await orChat({
      model,
      messages: [
        { role: "system", content: QS_GRAMMAR +
          `\nReturn STRICT JSON: an array of {row_no, row_kind ("item"|"note"), suggested_kind, stage_name (one of the recipe stages below, or null), material_guess (short purchasable material name, or null), mix_ratio (like "1:2:4", or null), confidence (0-1), field_confidence {qty,unit,rate,stage,material}}. One entry per input row. No prose.` +
          (stageList ? `\nRecipe stages:\n${stageList}` : "") },
        { role: "user", content: `Element: ${el}\nRows:\n${lines}` },
      ],
    });
    try {
      const out = JSON.parse(sliceJson(text, "[", "]")) as Record<string, unknown>[];
      for (const o of out) {
        const r = index.get(Number(o.row_no));
        if (!r) continue;                          // AI cannot invent rows
        if (o.row_kind === "note" || o.row_kind === "item") r.row_kind = o.row_kind as string;
        if (o.suggested_kind) r.suggested_kind = String(o.suggested_kind);
        if (o.mix_ratio) r.mix_ratio = String(o.mix_ratio);
        if (o.material_guess) r.material_guess = String(o.material_guess);
        if (o.stage_name) {
          const want = String(o.stage_name).toLowerCase();
          const hit = stages.find((s) => s.name.toLowerCase() === want) ??
                      stages.find((s) => s.name.toLowerCase().includes(want) || want.includes(s.name.toLowerCase()));
          if (hit) r.suggested_stage_id = hit.id;
        }
        if (o.confidence != null) r.confidence = Number(o.confidence);
        if (o.field_confidence) r.field_confidence = o.field_confidence as Record<string, number>;
      }
    } catch { /* enrichment is best-effort; deterministic rows stand on their own */ }
  }
  return rows;
}

// PDF / photo lane: no grid, so the model extracts rows against the same grammar.
// Continuation loop guards against output-token truncation on long bills.
export async function extractBoqV2FromFile(
  fileBase64: string, mime: string, stages: StageRef[],
): Promise<BoqV2Row[]> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (dev() || !key) {
    // Canned mini-bill exercising the whole grammar (offline/dev).
    return [
      { row_no: 1, row_kind: "element_header", raw_text: "ELEMENT 1 — SUBSTRUCTURE" },
      { row_no: 2, row_kind: "item", raw_text: "Excavate trench not exceeding 3m deep", boq_ref: "A", qty: 100, unit: "m3", rate: 3500, amount: 350000, is_priced: true, section_path: ["ELEMENT 1 — SUBSTRUCTURE"], suggested_kind: "labour", confidence: 0.95 },
      { row_no: 3, row_kind: "item", raw_text: "Concrete grade 20 (1:2:4) in foundation", boq_ref: "B", qty: 32, unit: "m3", rate: 195000, amount: 6240000, is_priced: true, section_path: ["ELEMENT 1 — SUBSTRUCTURE"], suggested_kind: "composite", mix_ratio: "1:2:4", confidence: 0.92 },
      { row_no: 4, row_kind: "summary", raw_text: "SUBSTRUCTURE TO SUMMARY", amount: 6590000, section_path: ["ELEMENT 1 — SUBSTRUCTURE"] },
    ];
  }
  const model = Deno.env.get("AI_BOQ_MODEL") ?? "anthropic/claude-sonnet-5";
  const stageList = stages.map((s) => `${s.sequence}. ${s.name}`).join("\n");
  const isImage = mime.startsWith("image/");
  const filePart = isImage
    ? { type: "image_url", image_url: { url: `data:${mime};base64,${fileBase64}` } }
    : { type: "file", file: { filename: "boq.pdf", file_data: `data:application/pdf;base64,${fileBase64}` } };

  const messages: Record<string, unknown>[] = [
    { role: "system", content: QS_GRAMMAR +
      `\nExtract EVERY row of the document in order as STRICT JSON: an array of
{row_no, row_kind ("item"|"note"|"element_header"|"section_header"|"column_header"|"collection"|"summary"|"title"|"footer"),
 boq_ref, raw_text (verbatim), resolved_text (ditto-resolved), qty, unit, rate, amount,
 is_priced, is_provisional, section_path (["ELEMENT …","section"]), suggested_kind,
 stage_name (one of the recipe stages, or null), material_guess, mix_ratio,
 confidence, field_confidence}.
Include collection/summary rows WITH their amounts — they are the check values. No prose.` +
      (stageList ? `\nRecipe stages:\n${stageList}` : "") },
    { role: "user", content: [
      { type: "text", text: "Extract the full bill. Return only the JSON array." },
      filePart,
    ] },
  ];
  // Continuation loop: if the model stops mid-array, ask it to continue.
  let text = "";
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, ...(isImage ? {} : { plugins: [{ id: "file-parser", pdf: { engine: "native" } }] }), messages, max_tokens: 16000 }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const part: string = data.choices?.[0]?.message?.content ?? "";
    text += part;
    if (data.choices?.[0]?.finish_reason !== "length") break;
    messages.push({ role: "assistant", content: part });
    messages.push({ role: "user", content: "Continue the JSON array exactly from where you stopped. Output only the remaining JSON, no repetition." });
  }
  const rows = JSON.parse(sliceJson(text, "[", "]")) as BoqV2Row[];
  const index = new Map(stages.map((s) => [s.name.toLowerCase(), s.id]));
  for (const r of rows) {
    const sn = (r as Record<string, unknown>)["stage_name"];
    if (sn) r.suggested_stage_id = index.get(String(sn).toLowerCase()) ?? null;
  }
  return rows;
}

// BOQ from a photo/scan (jpg/png/webp). Images use image_url with their real media type
// (Claude accepts jpeg/png/gif/webp) — unlike PDFs, which go through the `file` type.
export async function extractBoqFromImage(imageBase64: string, mediaType: string): Promise<BoqRow[]> {
  const devMode = (Deno.env.get("DEV_AI_MODE") ?? "true") !== "false";
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (devMode || !key) return DEV_ROWS;
  const model = Deno.env.get("AI_BOQ_MODEL") ?? "anthropic/claude-sonnet-5";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Extract the Bill of Quantities as strict JSON: an array of {raw_text, parsed_qty, parsed_unit, parsed_rate, confidence}. raw_text is the item name exactly as written. Numbers as strings. No prose." },
        { role: "user", content: [
          { type: "text", text: "Extract every BOQ line item from this image. Return only the JSON array." },
          { type: "image_url", image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
        ] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "[]";
  return JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)) as BoqRow[];
}

// AI-2: receipt / waybill OCR → structured fields.
export type Receipt = { amount: number; date: string; payee: string; confidence: number };
export async function extractReceipt(imageBase64: string): Promise<Receipt> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (dev() || !key) return { amount: 98000, date: "2026-07-20", payee: "BUA Cement", confidence: 0.95 };
  const model = Deno.env.get("AI_RECEIPT_MODEL") ?? "anthropic/claude-sonnet-5";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Extract {amount, date, payee, confidence} as strict JSON from this receipt. Numbers as numbers." },
        { role: "user", content: [
          { type: "text", text: "Extract the receipt fields." },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ] },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const t: string = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)) as Receipt;
}

// AI-8: embed a question for retrieval, then answer over retrieved context.
export async function embed(text: string): Promise<number[]> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (dev() || !key) return new Array(1536).fill(0.1); // deterministic stub
  const res = await fetch("https://openrouter.ai/api/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("AI_EMBED_MODEL") ?? "openai/text-embedding-3-small", input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding as number[];
}

export async function answer(question: string, context: string): Promise<string> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (dev() || !key) return `[dev] Based on the data, here is an answer to: "${question}".`;
  const model = Deno.env.get("AI_QA_MODEL") ?? "anthropic/claude-sonnet-5";
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "You are SiteLens's site analyst. Answer using ONLY the provided data (arithmetic over the figures) — never invent numbers, and if the answer isn't derivable, say so plainly. Format as clean, concise markdown: (1) one bold sentence giving the direct answer; (2) a short bullet list of the key figures that support it; (3) a final line beginning '**Suggested action:**' with one concrete next step. Keep it under ~120 words. You inform the decision; you do not make it for the user." },
        { role: "user", content: `Data:\n${context}\n\nQuestion: ${question}` },
      ],
    }),
  });
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}
