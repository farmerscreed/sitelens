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
