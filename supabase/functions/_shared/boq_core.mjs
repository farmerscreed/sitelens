// BOQ core (Phase 1, docs/BOQ_TRUE_COST_DESIGN.md §2/§5/§8/§10).
// Pure JS, zero dependencies — imported by the Deno edge function AND by Node tests
// (tests/boq_core_test.mjs runs this against the real NPC Xora Bay workbook).
// This is the DETERMINISTIC layer: grid annotation, unit dictionary, ditto
// resolution, arithmetic validation, reconciliation. The AI layer (ai-router)
// ENRICHES these rows (kind/stage/material/mix suggestions); it never bypasses them.

// ── §8 unit dictionary (mirror of SQL fn_normalize_unit; unknown → null) ──────
const UNIT_MAP = {
  m2: "m2", sqm: "m2", sm: "m2", "m²": "m2",
  m3: "m3", cum: "m3", "m³": "m3",
  t: "t", ton: "t", tons: "t", ttons: "t", tonne: "t", tonnes: "t",
  nr: "nr", nrs: "nr", no: "nr", nos: "nr", number: "nr",
  m: "m", lm: "m", linm: "m",
  item: "item", ltem: "item", itm: "item",
  kg: "kg", bag: "bag", bags: "bag", set: "set", sets: "set",
  sum: "sum", ls: "sum", pair: "pair", pairs: "pair",
};
export function normalizeUnit(u) {
  if (u == null) return null;
  const k = String(u).toLowerCase().replace(/[\s.,]/g, "");
  return UNIT_MAP[k] ?? null;
}

// Parse a cell that should be a number. Returns { value, coerced } — `coerced`
// marks a numeric-looking STRING ("1.57"); non-numeric text ("NOT APPLICABLE") → null.
export function parseNum(cell) {
  if (cell == null || cell === "") return { value: null, coerced: false };
  if (typeof cell === "number") return { value: cell, coerced: false };
  const s = String(cell).replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { value: null, coerced: false };
  return { value: Number(s), coerced: true };
}

const RX = {
  columnHeader: /\bDESCRIPTION\b/i,
  collection: /^to\s+collection\b/i,
  toSummary: /(to|carried\s+to)\s+sum+ary\b|carried\s+to\s+general\s+summary/i,
  pageFooter: /^page\s+\d+$/i,
  grandTotal: /general\s+summary|total\s+cost|sub-?\s*total|add\s+vat|less\s+wht/i,
  element: /^element\b/i,
  ditto: /^ditto\b/i,
  mixRatio: /\b1\s*:\s*\d+(?:\.\d+)?(?:\s*:\s*\d+(?:\.\d+)?)?\b/,
  provisional: /provisional/i,
};

// Map a header row's cells → column roles.
function detectLayout(cells) {
  const layout = {};
  cells.forEach((c, i) => {
    const t = String(c ?? "").trim().toLowerCase();
    if (!t) return;
    if (/^s\/?no?$/.test(t)) layout.sn = i;
    else if (/desc/.test(t)) layout.desc = i;
    else if (/^qty|quant/.test(t)) layout.qty = i;
    else if (/^unit/.test(t)) layout.unit = i;
    else if (/^rate/.test(t)) layout.rate = i;
    else if (/^amount/.test(t)) layout.amount = i;
  });
  return layout.desc != null && layout.qty != null ? layout : null;
}

const isUpperish = (s) => {
  const letters = s.replace(/[^A-Za-z]/g, "");
  if (!letters) return false;
  const upper = letters.replace(/[^A-Z]/g, "");
  return upper.length / letters.length > 0.8;
};

// ── PASS 1 (deterministic): classify every grid row against the §2 grammar ────
// grid: array of arrays (raw cells, row 0 = first sheet row).
// Returns { rows, layout } where each row = { row_no, row_kind, boq_ref, raw_text,
//   resolved_text, qty, unit, unit_normalized, rate, amount, is_provisional,
//   is_priced, section_path, mix_ratio, flags }.
export function annotateGrid(grid) {
  let layout = null;
  let element = null;          // current element header text
  let section = null;          // current sub-section text
  let provisionalZone = false; // element flagged ALL PROVISIONAL
  let lastItem = null;         // for ditto resolution
  const rows = [];

  for (let i = 0; i < grid.length; i++) {
    const cells = grid[i] ?? [];
    const joined = cells.map((c) => String(c ?? "").trim()).filter(Boolean).join(" ");
    if (!joined) continue; // blank

    // Column-header rows re-appear throughout; they (re)define the layout.
    if (RX.columnHeader.test(joined) && joined.length < 80) {
      const l = detectLayout(cells);
      if (l) layout = l;
      rows.push(base(i, "column_header", joined));
      continue;
    }

    if (!layout) {
      // Front matter: title pages and the GENERAL SUMMARY live before the first
      // header. Anything carrying an amount is a stated total, not an item.
      const amt = lastNumber(cells);
      if (amt != null && RX.grandTotal.test(joined)) {
        rows.push({ ...base(i, "summary", joined), amount: amt });
      } else if (amt != null) {
        rows.push({ ...base(i, "summary", joined), amount: amt });
      } else {
        rows.push(base(i, "title", joined));
      }
      continue;
    }

    const desc = String(cells[layout.desc] ?? "").trim();
    const sn = layout.sn != null ? String(cells[layout.sn] ?? "").trim() : "";
    const q = parseNum(cells[layout.qty]);
    const unitRaw = layout.unit != null ? String(cells[layout.unit] ?? "").trim() : "";
    const r = layout.rate != null ? parseNum(cells[layout.rate]) : { value: null, coerced: false };
    const rateText = layout.rate != null ? String(cells[layout.rate] ?? "").trim() : "";
    const a = layout.amount != null ? parseNum(cells[layout.amount]) : { value: null, coerced: false };
    const amount = a.value && a.value !== 0 ? a.value : null;
    const text = desc || joined;

    // Structure rows (checks, never items).
    if (RX.pageFooter.test(text)) {
      rows.push({ ...base(i, amount != null ? "collection" : "footer", text), amount });
      continue;
    }
    if (RX.collection.test(text)) {
      rows.push({ ...base(i, "collection", text, element, section), amount });
      continue;
    }
    if (RX.toSummary.test(text) || (RX.grandTotal.test(text) && q.value == null && r.value == null)) {
      rows.push({ ...base(i, "summary", text, element, section), amount });
      continue;
    }
    // Stated totals with no S/N, no qty, no rate — summary lines (e.g. the final
    // SUMMARY zone: "Element 1 Substructure  76,994,235").
    if (amount != null && q.value == null && r.value == null && !sn) {
      rows.push({ ...base(i, "summary", text, element, section), amount });
      continue;
    }

    // Element / section headers. Inside a final SUMMARY zone, "Element N …" lines
    // are stated totals (even ₦0 ones), never new elements.
    if (RX.element.test(text) && section && /^summary$/i.test(section)) {
      rows.push({ ...base(i, "summary", text, element, section), amount });
      continue;
    }
    if (RX.element.test(text) && q.value == null && amount == null) {
      element = text; section = null;
      provisionalZone = RX.provisional.test(text);
      rows.push(base(i, "element_header", text, element));
      continue;
    }
    const hasNumbers = q.value != null || r.value != null || amount != null;
    if (!hasNumbers && !unitRaw) {
      // No measurables at all: a heading if short/caps, otherwise a note.
      if (text.length < 60 && isUpperish(text)) {
        // A short caps row right after an ELEMENT header names it (ELEMENT 2 → FRAME) —
        // but boilerplate headings (GENERALLY / INFORMATION / SUMMARY) never do.
        if (element && rows.length && rows[rows.length - 1].row_kind === "element_header" &&
            !/^(GENERALLY|INFORMATION|SUMMARY)$/i.test(text)) {
          element = `${element} — ${text}`;
          rows[rows.length - 1].raw_text = element;
          if (RX.provisional.test(text)) provisionalZone = true;
          continue;
        }
        section = text;
        if (RX.provisional.test(text)) provisionalZone = true;
        rows.push(base(i, "section_header", text, element, section));
      } else {
        rows.push(base(i, "note", text, element, section));
      }
      continue;
    }
    // Long sentence with an S/N but nothing measurable except maybe "Item" —
    // the sample's preamble notes A–C. Notes, not items.
    if (q.value == null && r.value == null && amount == null && text.length > 90) {
      rows.push(base(i, "note", text, element, section));
      continue;
    }

    // ── An ITEM ──
    const flags = [];
    if (q.coerced) flags.push("qty_text_coerced");
    const unit_normalized = normalizeUnit(unitRaw);
    if (unitRaw && !unit_normalized) flags.push("unknown_unit");
    if (q.value == null) flags.push("missing_qty");
    if (q.value != null && !unitRaw) flags.push("missing_unit");
    const is_priced = r.value != null && r.value > 0;
    if (!is_priced && /not\s*applicable/i.test(rateText)) flags.push("rate_not_applicable");
    // Arithmetic self-check against the bill's own AMOUNT cell (§5).
    if (q.value != null && r.value != null && amount != null) {
      const expect = q.value * r.value;
      if (Math.abs(expect - amount) > Math.max(1, amount * 0.005)) flags.push("amount_mismatch");
    }
    let resolved_text = text;
    if (RX.ditto.test(text)) {
      if (lastItem) {
        resolved_text = `${text} [ditto: ${lastItem.resolved_text}]`;
        flags.push("ditto_resolved");
      } else flags.push("ditto_unresolved");
    }
    const mix = text.match(RX.mixRatio);
    const row = {
      ...base(i, "item", text, element, section),
      boq_ref: sn || null,
      resolved_text,
      qty: q.value, unit: unitRaw || null, unit_normalized,
      rate: r.value, amount,
      is_priced,
      is_provisional: provisionalZone || RX.provisional.test(text) || unitRaw.toLowerCase() === "sum",
      mix_ratio: mix ? mix[0].replace(/\s+/g, "") : null,
      flags,
    };
    rows.push(row);
    if (!RX.ditto.test(text)) lastItem = row;
  }
  return { rows, layout };

  function base(row_no, row_kind, raw_text, el = element, sec = section) {
    return {
      row_no: row_no + 1, row_kind, raw_text,
      boq_ref: null, resolved_text: null,
      qty: null, unit: null, unit_normalized: null, rate: null, amount: null,
      is_priced: true, is_provisional: false, mix_ratio: null,
      section_path: [el, sec].filter(Boolean),
      flags: [],
    };
  }
  function lastNumber(cells) {
    for (let j = cells.length - 1; j >= 0; j--) {
      if (typeof cells[j] === "number" && cells[j] !== 0) return cells[j];
    }
    return null;
  }
}

// ── PASS 3 (deterministic): cross-item checks + reconciliation (§5) ───────────
// Flags near-duplicate scope (same qty+rate, similar text) and reconciles
// extracted items against the document's own collections/summaries.
export function validateAndReconcile(rows) {
  const items = rows.filter((r) => r.row_kind === "item");

  // Possible double-count: identical qty & rate with overlapping wording.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.qty != null && a.qty === b.qty && a.rate != null && a.rate === b.rate) {
        const wa = new Set(a.raw_text.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
        const wb = b.raw_text.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
        const overlap = wb.filter((w) => wa.has(w)).length;
        if (overlap >= 1) {
          if (!a.flags.includes("possible_duplicate")) a.flags.push("possible_duplicate");
          if (!b.flags.includes("possible_duplicate")) b.flags.push("possible_duplicate");
        }
      }
    }
  }

  // Per-element extracted vs stated ("… TO SUMMARY" amount inside the element).
  const elements = new Map(); // element → {extracted, stated}
  for (const r of rows) {
    const el = r.section_path[0] ?? "(front matter)";
    if (!elements.has(el)) elements.set(el, { element: el, extracted: 0, stated: null });
    const e = elements.get(el);
    if (r.row_kind === "item") {
      const line = r.amount ?? (r.qty != null && r.rate != null ? r.qty * r.rate : 0);
      e.extracted += line ?? 0;
    } else if (r.row_kind === "summary" && r.amount != null && RX.toSummary.test(r.raw_text) &&
               !/general\s+summary/i.test(r.raw_text)) {  // grand rows are not element stateds
      e.stated = r.amount;
    }
  }
  const sections = [...elements.values()]
    .filter((e) => e.element !== "(front matter)")
    .filter((e) => e.extracted !== 0 || e.stated != null)  // drop header-only ghosts
    .map((e) => ({
      ...e,
      extracted: round2(e.extracted),
      ok: e.stated == null || Math.abs(e.extracted - e.stated) <= Math.max(1, e.stated * 0.005),
    }));

  const extracted_total = round2(sections.reduce((s, e) => s + e.extracted, 0));
  // Stated grand: prefer an explicit "CARRIED TO GENERAL SUMMARY" line, else Σ stated.
  const grandRow = rows.find(
    (r) => r.row_kind === "summary" && r.amount != null && /carried\s+to\s+general\s+summary/i.test(r.raw_text),
  );
  const stated_total = grandRow?.amount ??
    (sections.some((s) => s.stated != null)
      ? round2(sections.reduce((s, e) => s + (e.stated ?? e.extracted), 0))
      : null);
  const variance_pct = stated_total
    ? round2(((extracted_total - stated_total) / stated_total) * 100 * 1000) / 1000
    : null;

  const priced_total = round2(items.filter((r) => r.is_priced)
    .reduce((s, r) => s + (r.amount ?? (r.qty ?? 0) * (r.rate ?? 0)), 0));
  const unpriced = items.filter((r) => !r.is_priced);

  return {
    rows,
    reconciliation: {
      extracted_total, stated_total, variance_pct,
      sections,
      flagged_rows: items.filter((r) => r.flags.length).length,
      item_count: items.length,
    },
    document_totals: {
      grand: stated_total,
      front_matter: rows
        .filter((r) => r.row_kind === "summary" && r.section_path.length === 0 && r.amount != null)
        .map((r) => ({ label: r.raw_text, amount: r.amount })),
      elements: sections.map((s) => ({ element: s.element, stated: s.stated })),
    },
    priced_total,
    unpriced_count: unpriced.length,
  };
}
const round2 = (n) => Math.round(n * 100) / 100;

// ── DEV brain: kind suggestions without an LLM (DEV_AI_MODE / no key) ─────────
// In production the AI enriches rows; this deterministic stand-in keeps the whole
// pipeline runnable offline and gives tests stable behaviour.
export function devSuggestKinds(rows) {
  for (const r of rows) {
    if (r.row_kind !== "item") continue;
    const t = r.resolved_text?.toLowerCase() ?? "";
    // Zone-level is_provisional stays a flag; the KIND classifies the work's nature.
    if (r.unit_normalized === "sum") r.suggested_kind = "provisional";
    // Supply words BEFORE composite words: "reinforcement for in-situ concrete"
    // and "12mm diameter in pad base" are STEEL, not concrete.
    else if (/reinforcement|\bbars?\b|\bdiameter\b|stirrup|sand\b|cement\b|granite|polythene|membrane|roofing sheet|tiles?\b/.test(t)) r.suggested_kind = "material_supply";
    else if (/soffit|form\s*work|shutter|edges of|sides of/.test(t)) r.suggested_kind = "plant";
    else if (/concrete|blockwork|mortar|render|screed|plaster/.test(t)) r.suggested_kind = "composite";
    else if (/excavat|clear|remove|filling|disposal|compact|protect|keep/.test(t)) r.suggested_kind = "labour";
    else if (/door|window|wardrobe|cabinet|sink|wc\b|heater|rail/.test(t)) r.suggested_kind = "fitting";
    else if (/soffit|form\s*work|shutter/.test(t)) r.suggested_kind = "plant";
    else r.suggested_kind = sectionKind(r.section_path) ?? "other";
  }
  return rows;
}

// When a row's own text is mute ("Pad bases", "To Beam and roof beams"), its BILL
// SECTION heading usually says what it is — use it before giving up on 'other'.
export function sectionKind(sectionPath) {
  const ctx = (sectionPath ?? []).join(" ").toLowerCase();
  if (!ctx) return null;
  if (/form\s*work/.test(ctx)) return "plant";
  if (/reinforcement/.test(ctx)) return "material_supply";
  if (/concrete|block\s*work|render|plaster|screed|mortar/.test(ctx)) return "composite";
  if (/iron\s*mongery|doors|windows|sanitary|fittings|fixtures/.test(ctx)) return "fitting";
  if (/excavat|earthwork|disposal|filling|site preparation|demolition/.test(ctx)) return "labour";
  if (/provisional/.test(ctx)) return "provisional";
  return null;
}

// Serialize staged rows for fn_stage_boq_rows_v2 (numbers as strings, per RPC).
export function toStagePayload(rows, modelId) {
  return rows.map((r) => ({
    row_no: r.row_no != null ? String(r.row_no) : "",
    raw_text: r.raw_text,
    parsed_qty: r.qty != null ? String(r.qty) : "",
    parsed_unit: r.unit ?? "",
    parsed_rate: r.rate != null ? String(r.rate) : "",
    confidence: r.confidence != null ? String(r.confidence) : "",
    row_kind: r.row_kind,
    boq_ref: r.boq_ref ?? "",
    section_path: r.section_path,
    resolved_text: r.resolved_text ?? "",
    amount: r.amount != null ? String(r.amount) : "",
    is_provisional: !!r.is_provisional,
    is_priced: !!r.is_priced,
    suggested_stage_id: r.suggested_stage_id ?? "",
    suggested_kind: r.suggested_kind ?? "",
    mix_ratio: r.mix_ratio ?? "",
    material_guess: r.material_guess ?? "",
    flags: r.flags ?? [],
    field_confidence: r.field_confidence ?? null,
    model_id: modelId ?? "",
  }));
}
