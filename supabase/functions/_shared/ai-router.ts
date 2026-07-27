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
            { type: "text", text: "Extract every BOQ line item from this document." },
            { type: "image_url", image_url: { url: `data:application/pdf;base64,${pdfBase64}` } },
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
