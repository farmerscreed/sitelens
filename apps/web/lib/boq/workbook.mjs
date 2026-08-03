// Workbook intelligence (browser-side, deterministic, zero deps) — the layer that
// lets a MULTI-SHEET workbook through the import front door correctly.
// Real workbooks are not "one bill": they mix bill sheets, a rates/build-ups sheet,
// summaries, procurement schedules and notes — and sometimes a cumulative sheet
// that DUPLICATES the per-section sheets (importing both double-counts the money).
// This module classifies every sheet, detects that duplication, and parses the
// non-bill sheets into review candidates. Everything it returns is a PROPOSAL the
// human confirms on the workbook map (Rule 3); nothing here writes anything.
// Node tests: tests/boq_workbook_test.mjs (fixtures modelled on the two real
// Vantara workbooks: the QS original and the AI-rescoped working BOQ).

const S = (c) => String(c ?? "").trim();

function parseNum(cell) {
  if (cell == null || cell === "") return null;
  if (typeof cell === "number") return cell;
  const s = String(cell).replace(/,/g, "").trim();
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

// Mirror of boq_core's layout detector (kept self-contained: this runs in the
// browser bundle, boq_core runs in the edge function). First match wins per
// role — trailing columns like "Qty source / notes" must never steal Qty.
function detectLayout(cells) {
  const layout = {};
  const set = (k, i) => { if (layout[k] == null) layout[k] = i; };
  cells.forEach((c, i) => {
    const t = S(c).toLowerCase();
    if (!t) return;
    if (/^s\/?no?$/.test(t) || /^(item|ref)\.?$/.test(t)) set("sn", i);
    else if (/desc/.test(t)) set("desc", i);
    else if (/^qty|quant/.test(t)) set("qty", i);
    else if (/^unit/.test(t)) set("unit", i);
    else if (/^material\s*rate/.test(t)) set("rateMaterial", i);
    else if (/^labou?r\s*rate/.test(t)) set("rateLabour", i);
    else if (/^(total\s*)?rate/.test(t)) set("rate", i);
    else if (/^(material|labou?r)\s*amount/.test(t)) { /* component amounts */ }
    else if (/^(total\s*)?amount/.test(t)) set("amount", i);
  });
  return layout.desc != null && layout.qty != null ? layout : null;
}

/** Drop trailing all-blank rows (real sheets carry hundreds). */
export function trimGrid(grid) {
  let last = (grid ?? []).length - 1;
  while (last >= 0 && (grid[last] ?? []).every((c) => S(c) === "")) last--;
  return (grid ?? []).slice(0, last + 1);
}

// Walk a sheet with bill eyes: re-detect the layout at every header row (column
// order flips BETWEEN sheets of the same workbook in the wild), count measured
// item rows, and fingerprint them for duplicate detection.
function scanBill(grid) {
  let layout = null;
  let items = 0;
  let split = false;
  const fps = [];
  for (const cells of grid) {
    const l = detectLayout(cells);
    if (l) {
      layout = l;
      if (l.rateMaterial != null && l.rateLabour != null) split = true;
      continue;
    }
    if (!layout) continue;
    const desc = S(cells[layout.desc]);
    const qty = parseNum(cells[layout.qty]);
    if (!desc || qty == null) continue;
    if (/\btotal\b/i.test(desc)) continue; // check rows, not items
    items++;
    fps.push(`${desc.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80)}|${qty}`);
  }
  return { items, fps, split };
}

const ROLE_LABEL = {
  bill: "Bill of quantities",
  rates: "Rates / build-ups",
  summary: "Summary / budget",
  reference: "Quantity schedule",
  notes: "Notes & assumptions",
  empty: "Empty",
  unknown: "Unrecognised",
};
export { ROLE_LABEL };

/**
 * Classify one sheet. Bill shape wins over any name hint; the rest fall through
 * name → content heuristics. Returns { role, itemCount, hasSplitRates, fps }.
 */
export function classifySheet(name, grid) {
  const g = trimGrid(grid);
  if (g.length === 0) return { role: "empty", itemCount: 0, hasSplitRates: false, fps: [] };

  const bill = scanBill(g);
  if (bill.items >= 2) {
    return { role: "bill", itemCount: bill.items, hasSplitRates: bill.split, fps: bill.fps };
  }

  const n = name.toLowerCase();
  const content = g.slice(0, 40).map((r) => (r ?? []).map(S).join(" ")).join(" ").toUpperCase();

  let role = "unknown";
  if (/rate|input/.test(n) || /MATERIAL INPUT PRICES|RATE BUILD|CREW RATES|DERIVED RATES/.test(content)) role = "rates";
  else if (/schedule|rebar|procure/.test(n) || /PROCUREMENT SCHEDULE|BAR SIZE/.test(content)) role = "reference";
  else if (/assumption|basis|exclusion|note/.test(n) || /ASSUMPTIONS|QUALIFICATIONS|EXCLUSIONS|BASIS OF MEASUREMENT/.test(content)) role = "notes";
  else if (/summary/.test(n) || /GENERAL SUMMARY|EXECUTIVE SUMMARY|GRAND TOTAL|BASE CONSTRUCTION COST|BUDGET TOTAL/.test(content)) role = "summary";

  return { role, itemCount: bill.items, hasSplitRates: bill.split, fps: bill.fps };
}

/**
 * Build the human-confirmable workbook map: every sheet classified, duplicated
 * bill sheets detected (≥60% of a sheet's items appearing in a same-or-larger
 * sheet → it is the subset; the superset stays in). Default include: bills that
 * are not duplicates. Rates/reference/summary sheets default OFF for import but
 * carry their role so later steps (prices, check values) can offer them.
 */
export function buildWorkbookMap(sheets) {
  const entries = sheets.map(({ name, grid }) => {
    const c = classifySheet(name, grid);
    return {
      name, role: c.role, itemCount: c.itemCount, hasSplitRates: c.hasSplitRates,
      fps: c.fps, duplicateOf: null, include: c.role === "bill",
    };
  });

  const bills = entries.filter((e) => e.role === "bill");
  for (const a of bills) {
    if (a.duplicateOf) continue;
    const setA = new Set(a.fps);
    for (const b of bills) {
      if (b === a || b.duplicateOf) continue;
      if (b.fps.length < setA.size) continue;               // only a same-or-larger sheet can absorb a
      if (b.fps.length === setA.size && sheets.findIndex((s) => s.name === b.name) > sheets.findIndex((s) => s.name === a.name)) continue; // equal twins: keep the first
      const setB = new Set(b.fps);
      let shared = 0;
      for (const f of setA) if (setB.has(f)) shared++;
      if (setA.size > 0 && shared / setA.size >= 0.6) {
        a.duplicateOf = b.name;
        a.include = false;
        break;
      }
    }
  }
  // fps are working data, not UI state — strip them from the returned map.
  return entries.map(({ fps: _fps, ...e }) => e);
}

/**
 * Parse a rates/build-ups sheet ("Rates & Inputs") into review candidates.
 * Row shape: [label, unit, value, note]. Section headers ("A. MATERIAL INPUT
 * PRICES" / "B. LABOUR…" / "C. DERIVED…") set the row kind:
 *   price   → a real delivered material price (candidate for material_prices)
 *   labour  → a crew rate (reference for assembly labour rates)
 *   buildup → a derived all-in build-up (reference; NEVER a price — Rule §7)
 */
export function parseRatesSheet(grid) {
  const rows = [];
  let kind = "price";
  for (const cells of trimGrid(grid)) {
    const label = S(cells[0]);
    if (!label) continue;
    const value = parseNum(cells[2]);
    if (value == null) {
      const up = label.toUpperCase();
      if (/MATERIAL INPUT|PRICES/.test(up)) kind = "price";
      else if (/LABOUR|CREW/.test(up)) kind = "labour";
      else if (/DERIVED|BUILD-?UP|FORMULA/.test(up)) kind = "buildup";
      continue;
    }
    const unit = S(cells[1]) || null;
    const note = S(cells[3]) || null;
    rows.push({ label, unit, value, note, kind });
  }
  return rows;
}

/**
 * Parse a reference/summary sheet into check-value candidates.
 * Two shapes are recognised:
 *  1. label | unit | quantity   (materials/procurement schedules)
 *  2. label | … | number        (rebar totals, summary money lines) — the LAST
 *     numeric cell is taken; role 'summary' stores it as an amount (₦), any
 *     other role as a quantity.
 * Section headings (no numbers, short) are tracked and attached to their rows.
 */
export function parseCheckSheet(grid, role) {
  const g = trimGrid(grid);
  // Mapped shape first: a header row naming unit + quantity columns.
  let cols = null;
  for (const cells of g) {
    let unitIdx = null, qtyIdx = null, labelIdx = 0;
    cells.forEach((c, i) => {
      const t = S(c).toLowerCase();
      if (/^unit/.test(t)) unitIdx = i;
      else if (/^qty|^quant/.test(t)) qtyIdx = i;
    });
    if (unitIdx != null && qtyIdx != null) { cols = { labelIdx, unitIdx, qtyIdx }; break; }
  }

  const rows = [];
  let section = null;
  for (const cells of g) {
    const label = S(cells[0]);
    if (!label) continue;
    if (cols) {
      const qty = parseNum(cells[cols.qtyIdx]);
      const unit = S(cells[cols.unitIdx]) || null;
      if (qty == null) {
        if (label.length < 70 && !parseNum(cells[1])) section = label.replace(/\s*\|.*$/, "");
        continue;
      }
      rows.push({ label, unit, qty, amount: null, section });
    } else {
      // The MAX numeric cell, not the last: summary rows carry "% of base"
      // fractions after the amount, rebar rows carry per-zone parts before the
      // total — the meaningful figure dominates both.
      let best = null;
      for (let j = 1; j < cells.length; j++) {
        const v = parseNum(cells[j]);
        if (v != null && (best == null || v > best)) best = v;
      }
      if (best == null) {
        if (label.length < 70) section = label;
        continue;
      }
      if (role === "summary") rows.push({ label, unit: null, qty: null, amount: best, section });
      else rows.push({ label, unit: null, qty: best, amount: null, section });
    }
  }
  return rows;
}
