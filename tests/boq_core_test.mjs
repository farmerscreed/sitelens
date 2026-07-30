// Phase 1 gate test (docs/BOQ_TRUE_COST_DESIGN.md §12) for the deterministic BOQ
// core: grid annotation, unit dictionary, ditto resolution, validation and
// reconciliation. Runs with plain Node (no deps beyond the web app's SheetJS).
//
//   node tests/boq_core_test.mjs
//
// Part A (always): synthetic grid covering the §2 grammar.
// Part B (when the real bill is present in docs/): the NPC Xora Bay gate —
//   zero junk items, 15 elements, dittos resolved, reconciliation within 0.5%
//   of the bill's own ₦289,075,717.35, unpriced scope surfaced.
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import {
  annotateGrid, devSuggestKinds, validateAndReconcile, normalizeUnit, toStagePayload,
} from "../supabase/functions/_shared/boq_core.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error(`  FAIL: ${msg}`); fails++; } };

// ── Part A: synthetic grammar coverage ───────────────────────────────────────
{
  const grid = [
    ["", "PROPOSED BUILDING"],                                          // title
    ["", "", "GENERAL SUMMARY"],
    ["", "", "MAIN WORKS", "", "", "", 1000000],                        // stated (front)
    ["", "S/N", "DESCRIPTION", "QTY", "UNIT", "RATE", "AMOUNT"],        // header
    ["", "", "ELEMENT 1"],
    ["", "", "SUBSTRUCTURE (ALL PROVISIONAL)"],                         // merges into element
    ["", "A", "The work in this section comprises of excavations and other works up to and including the ground floor slab", "", "Item"], // note (unit trap)
    ["", "B", "Excavate trench not exceeding 3m deep", 100, "Cu.m", 3500, 350000],
    ["", "C", "Ditto Working Space", "", "m3"],                         // ditto, missing qty
    ["", "", "Vibrated reinforced concrete (grade 25) 16 cubic metre total volume filled into formwork and well packed around reinforcement"], // narrative qty — must NOT be an item
    ["", "D", "Concrete grade 20 (1:2:4) in foundation", "2", "cu.m", 195000, 390000], // qty as text + mix
    ["", "E", "Wall tiles supply and fix", 50, "Sq,m", "NOT APPLICABLE"], // unpriced, comma unit
    ["", "", "To Collection", "", "", "", 740000],
    ["", "", "Page 1"],
    ["", "", "SUBSTRUCTURE TO SUMMARY", "", "", "", 740000],
    ["", "", "BILL NO 1 CARRIED TO GENERAL SUMMARY", "", "", "", 740000],
  ];
  const { rows } = annotateGrid(grid);
  devSuggestKinds(rows);
  const out = validateAndReconcile(rows);
  const items = rows.filter((r) => r.row_kind === "item");

  ok(items.length === 4, `synthetic: 4 items, got ${items.length}`);
  ok(!items.some((r) => /to collection|summary|^page/i.test(r.raw_text)), "synthetic: no structure rows as items");
  ok(!items.some((r) => /total volume/i.test(r.raw_text)), "synthetic: narrative-qty row leaked as item");
  ok(rows.some((r) => r.row_kind === "note" && /comprises/.test(r.raw_text)), "synthetic: preamble note classified");
  const ditto = items.find((r) => /^ditto/i.test(r.raw_text));
  ok(ditto?.flags.includes("ditto_resolved") && /Excavate trench/.test(ditto.resolved_text), "synthetic: ditto resolved to trench item");
  ok(ditto?.flags.includes("missing_qty"), "synthetic: ditto missing qty flagged");
  const conc = items.find((r) => /grade 20/.test(r.raw_text));
  ok(conc?.mix_ratio === "1:2:4", `synthetic: mix ratio read (got ${conc?.mix_ratio})`);
  ok(conc?.qty === 2 && conc.flags.includes("qty_text_coerced"), "synthetic: text qty coerced+flagged");
  ok(conc?.unit_normalized === "m3", "synthetic: cu.m → m3");
  const tiles = items.find((r) => /tiles/.test(r.raw_text));
  ok(tiles?.is_priced === false && tiles.flags.includes("rate_not_applicable"), "synthetic: NOT APPLICABLE → unpriced");
  ok(tiles?.unit_normalized === "m2", "synthetic: 'Sq,m' → m2");
  ok(items.every((r) => r.is_provisional), "synthetic: ALL PROVISIONAL zone marks items");
  ok(items.every((r) => r.section_path[0]?.includes("SUBSTRUCTURE")), "synthetic: element context attached");
  const rec = out.reconciliation;
  ok(rec.stated_total === 740000 && rec.extracted_total === 740000 && rec.variance_pct === 0,
    `synthetic: reconciliation exact (extracted ${rec.extracted_total} vs ${rec.stated_total})`);
  ok(out.unpriced_count === 2, `synthetic: 2 unpriced items (tiles + ditto), got ${out.unpriced_count}`);
  ok(out.document_totals.front_matter.some((f) => f.amount === 1000000), "synthetic: front-matter total captured");

  // Unit dictionary spot checks (§8).
  for (const [raw, want] of [["Cu.m","m3"],["Sq.m.","m2"],["Ttons","t"],["Nrs","nr"],["l.m","m"],["ltem","item"],["Bags","bag"],["xyz",null]])
    ok(normalizeUnit(raw) === want, `unit ${raw} → ${want}, got ${normalizeUnit(raw)}`);

  // Stage payload serialization keeps kinds/flags and stringifies numbers.
  const payload = toStagePayload(rows, "dev");
  ok(payload.every((p) => typeof p.parsed_qty === "string" && Array.isArray(p.flags)), "payload shape");
}

// ── Part B: the real NPC Xora Bay bill (gate) ────────────────────────────────
const billPath = path.join(root, "docs", "BOQ FOR NPC XORA BAY 2 BEDROOM STRETCH TERRACE 150526.xlsx");
if (!fs.existsSync(billPath)) {
  console.log("boq_core: PART B SKIPPED (sample bill not in docs/)");
} else {
  const XLSX = await import(path.join(root, "apps/web/node_modules/xlsx/xlsx.mjs"));
  const wb = XLSX.read(fs.readFileSync(billPath), { type: "buffer" });
  const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", blankrows: true });
  const { rows } = annotateGrid(grid);
  devSuggestKinds(rows);
  const out = validateAndReconcile(rows);
  const items = rows.filter((r) => r.row_kind === "item");

  ok(!items.some((r) => /to collection|to sum+ary|^page \d|general summary|total cost|bill no/i.test(r.raw_text)),
    "gate: zero structure rows staged as items");
  ok(!items.some((r) => /soil test report|the work in this section|contractor is to refer|total volume filled/i.test(r.raw_text)),
    "gate: zero preamble/narrative rows staged as items");
  const els = rows.filter((r) => r.row_kind === "element_header");
  ok(els.length === 15, `gate: 15 elements (got ${els.length})`);
  const dittos = items.filter((r) => /^ditto/i.test(r.raw_text));
  ok(dittos.length === 12 && dittos.every((r) => r.flags.includes("ditto_resolved")),
    `gate: all dittos resolved (${dittos.filter((r) => r.flags.includes("ditto_resolved")).length}/${dittos.length})`);
  const rec = out.reconciliation;
  ok(Math.abs(rec.stated_total - 289075717.352941) < 0.01, `gate: stated grand read (${rec.stated_total})`);
  ok(Math.abs(rec.variance_pct) <= 0.5, `gate: reconciliation within 0.5% (got ${rec.variance_pct}%)`);
  ok(rec.sections.filter((s) => s.stated != null).every((s) => s.ok),
    "gate: every element with a stated total cross-casts");
  ok(out.unpriced_count >= 30, `gate: unpriced scope surfaced (${out.unpriced_count} items)`);
  ok(items.some((r) => r.flags.includes("possible_duplicate") && /vegetable soil/i.test(r.raw_text)),
    "gate: clearing/topsoil double-count flagged");
  ok(items.some((r) => r.mix_ratio === "1:6"), "gate: mortar ratio 1:6 read from blockwork");
  console.log(`boq_core PART B: ${items.length} items · extracted ₦${rec.extracted_total.toLocaleString()} vs stated ₦${rec.stated_total.toLocaleString()} (${rec.variance_pct}%) · ${out.unpriced_count} unpriced · ${rec.flagged_rows} flagged`);
}

if (fails) { console.error(`boq_core: ${fails} FAILURE(S)`); process.exit(1); }
console.log("boq_core: ALL PASS");
