// Workbook-ingest gate test: sheet classification, duplicate-sheet detection,
// rates/check-sheet parsing (apps/web/lib/boq/workbook.mjs) and the boq_core
// grammar extensions that carry them (split material/labour rates, SECTION/BILL
// TOTAL check rows, numbered section headings, works-title element promotion).
//
//   node tests/boq_workbook_test.mjs
//
// Part A (always): synthetic fixtures modelled on the two real Vantara workbooks —
//   the QS original (split rates; a cumulative sheet duplicating per-floor sheets;
//   column order flipping BETWEEN sheets) and the AI-rescoped working BOQ
//   (bill-per-sheet; a Rates & Inputs sheet; Materials Schedule; Summary).
// Part B (when VANTARA_BOQ_DIR points at the real folder): both real workbooks
//   must classify correctly and the known duplication must be caught.
import { fileURLToPath, pathToFileURL } from "url";
import path from "path";
import fs from "fs";
import {
  classifySheet, buildWorkbookMap, parseRatesSheet, parseCheckSheet, trimGrid,
} from "../apps/web/lib/boq/workbook.mjs";
import { annotateGrid, validateAndReconcile } from "../supabase/functions/_shared/boq_core.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error(`  FAIL: ${msg}`); fails++; } };

// ── Part A fixtures ──────────────────────────────────────────────────────────
// QS-original style: split material/labour rates, Quantity BEFORE Unit.
const SPLIT_HDR = ["Item", "Description", "Quantity", "Unit", "Material Rate (₦)", "Labour Rate (₦)", "Material Amount (₦)", "Labour Amount (₦)", "Total Rate (₦)", "Total Amount (₦)"];
const subItems = [
  ["S01", "Site clearance and setting out", 190, "m2", 750, 450, 142500, 85500, 1200, 228000],
  ["S02", "Excavate foundation trenches", 130.5, "m3", 0, 6500, 0, 848250, 6500, 848250],
  ["S03", "High-yield reinforcement Y16 in pad foundations", 4200, "kg", 1450, 260, 6090000, 1092000, 1710, 7182000],
];
const groundItems = [
  ["G01", "C20 reinforced concrete in ground floor columns", 10.8, "m3", 148000, 36000, 1598400, 388800, 184000, 1987200],
  ["G02", "Formwork to columns", 122, "m2", 13000, 7500, 1586000, 915000, 20500, 2501000],
  ["G03", "225mm external sandcrete block walling", 210, "m2", 12000, 5500, 2520000, 1155000, 17500, 3675000],
];
// The cumulative sheet: BOTH zones, works titles above repeated headers, SECTION TOTALs.
const cumulativeSheet = [
  ["SUBSTRUCTURE WORKS"],
  SPLIT_HDR,
  ...subItems,
  ["SECTION TOTAL", "", "", "", "", "", 6232500, 2025750, 9410, 8258250],
  [],
  ["GROUND FLOOR WORKS - 1-BEDROOM FLAT + HOME OFFICE"],
  SPLIT_HDR,
  ...groundItems,
  ["SECTION TOTAL", "", "", "", "", "", 5704400, 2458800, 222000, 8163200],
];
// The per-zone sheet duplicating the cumulative one — with Unit BEFORE Quantity.
const groundSheet = [
  ["GROUND FLOOR WORKS - 1-BEDROOM FLAT + HOME OFFICE"],
  ["Item", "Description", "Unit", "Quantity", "Material Rate (₦)", "Labour Rate (₦)", "Material Amount (₦)", "Labour Amount (₦)", "Total Rate (₦)", "Total Amount (₦)", "Remark"],
  ...groundItems.map((r) => [r[0], r[1], r[3], r[2], r[4], r[5], r[6], r[7], r[8], r[9]]),
  ["SECTION TOTAL", "", "", "", "", "", 5704400, 2458800, 222000, 8163200],
];
// A non-duplicated bill sheet (external works).
const externalSheet = [
  ["EXTERNAL WORKS AND COMMON SERVICES"],
  ["Item", "Description", "Unit", "Quantity", "Material Rate (₦)", "Labour Rate (₦)", "Material Amount (₦)", "Labour Amount (₦)", "Total Rate (₦)", "Total Amount (₦)"],
  ["E01", "Apron concrete paving around building, 100mm thick", "m2", 60, 18500, 6500, 1110000, 390000, 25000, 1500000],
  ["E02", "Surface drainage channels around building", "m", 55, 32000, 11000, 1760000, 605000, 43000, 2365000],
  ["SECTION TOTAL", "", "", "", "", "", 2870000, 995000, 68000, 3865000],
];

// Working-BOQ style: single-rate bill with numbered section headings + subtotals.
const workingBill = [
  ["BILL 2 — SUBSTRUCTURE (to DPC)"],
  ["Takeoff: pad layout FC1-FC16, foundation section, ground plate"],
  [],
  ["Item", "Description", "Unit", "Qty", "Rate (₦)", "Amount (₦)", "Qty source / notes"],
  ["2.0 Earthworks"],
  ["2.01", "Site clearance, strip vegetation/topsoil, setting out", "m2", 200, 1200, 240000],
  ["2.02", "Excavate 16nr pad pits avg 1.25m deep incl working space", "m3", 146, 4500, 657000],
  ["", "2.0 Earthworks — subtotal", "", "", "", 897000],
  ["2.1 Foundations (concrete & reinforcement)"],
  ["2.07", "50mm blinding under pads, mass concrete", "m3", 4, 142800, 571200],
  ["2.08", "C20 RC pad foundations FC1-FC16 (d=500)", "m3", 37.5, 153368, 5751300],
  ["", "2.1 Foundations — subtotal", "", "", "", 6322500],
  [],
  ["", "BILL 2 — SUBSTRUCTURE — BILL TOTAL", "", "", "", 7219500],
];
const ratesSheet = [
  ["RATE BUILD-UPS — EDIT ONLY THE YELLOW/BLUE INPUT CELLS."],
  ["Input prices = Aug-2026 Port Harcourt/Eleme market (delivered site)."],
  ["A. MATERIAL INPUT PRICES"],
  ["Cement, 50kg bag (trailer-load pricing)", "bag", 10500],
  ["Sharp sand, per m3 (20t tipper ~13 m3 @ N75k)", "m3", 5800],
  ["Granite, per m3 (30t ~20 m3 @ N1.30m)", "m3", 65000],
  ["B. LABOUR / CREW RATES"],
  ["Concrete mix/place (ground work), per m3", "m3", 18000],
  ["Blocklaying, per m2", "m2", 4000],
  ["C. DERIVED RATES (formulas — do not overwrite)"],
  ["C20 concrete MATERIALS per m3", "m3", 135368, "6.8 bags(incl waste) + 0.46m3 sand + 0.92m3 granite"],
  ["230mm blockwork MATERIALS per m2", "m2", 12672, "10 blocks + mortar"],
];
const materialsSchedule = [
  ["MATERIALS PROCUREMENT SCHEDULE — driven by bill quantities + input prices"],
  ["Material", "Unit", "Quantity", "Note"],
  ["CONCRETE (site-batched)"],
  ["Total C20 concrete", "m3", 179.48, "frame + pads + stubs + ground slab"],
  ["TOTAL CEMENT (order in trailer loads of ~600)", "bags", 1821],
  ["REINFORCEMENT (order full tonnage, cut on site)"],
  ["Y16 (pads, top-lift columns, beams, roof)", "kg", 6300, "333 x 12m bars"],
];
const summarySheet = [
  ["PRIMROSE G+3 — WORKING BOQ — GENERAL SUMMARY"],
  ["Bill", "", "Amount (₦)", "% of base"],
  ["BILL 2 — SUBSTRUCTURE", "", 24079063.73, 0.155],
  ["BILL 3 — RC FRAME", "", 61704883.33, 0.396],
  ["BASE CONSTRUCTION COST — SEMI-FINISHED (Bills 1-9)", "", 155709487.06, 1],
];
const assumptionsSheet = [
  ["ASSUMPTIONS, QUALIFICATIONS & EXCLUSIONS"],
  ["SCOPE: this is a SEMI-FINISHED contract BOQ."],
];

// ── Part A: classification ───────────────────────────────────────────────────
{
  ok(classifySheet("01 Substructure", cumulativeSheet).role === "bill", "cumulative sheet → bill");
  ok(classifySheet("01 Substructure", cumulativeSheet).hasSplitRates === true, "split rates detected");
  ok(classifySheet("Bill2 Substructure", workingBill).role === "bill", "working bill → bill");
  ok(classifySheet("Bill2 Substructure", workingBill).hasSplitRates === false, "single-rate bill → no split");
  ok(classifySheet("Rates & Inputs", ratesSheet).role === "rates", "rates sheet → rates");
  ok(classifySheet("Materials Schedule", materialsSchedule).role === "reference", "schedule → reference");
  ok(classifySheet("Rebar Summary", [["REINFORCEMENT BAR PROCUREMENT SUMMARY"], ["Bar Size", "Substructure kg", "Total kg"], ["Y10", 2200, 16650]]).role === "reference", "rebar summary → reference (not summary)");
  ok(classifySheet("Summary", summarySheet).role === "summary", "summary → summary");
  ok(classifySheet("Assumptions & Exclusions", assumptionsSheet).role === "notes", "assumptions → notes");
  ok(classifySheet("Blank", [[], []]).role === "empty", "blank → empty");
  const wb = classifySheet("Bill2 Substructure", workingBill);
  ok(wb.itemCount === 4, `working bill itemCount 4, got ${wb.itemCount}`);
}

// ── Part A: duplicate detection (the Lawrence sheet-01 trap) ─────────────────
{
  const map = buildWorkbookMap([
    { name: "01 Substructure", grid: cumulativeSheet },
    { name: "02 Ground Floor", grid: groundSheet },
    { name: "07 External-MEP", grid: externalSheet },
    { name: "Rebar Summary", grid: [["Bar Size", "Total kg"], ["Y10", 16650]] },
  ]);
  const bySheet = Object.fromEntries(map.map((e) => [e.name, e]));
  ok(bySheet["02 Ground Floor"].duplicateOf === "01 Substructure", `subset sheet marked duplicate (got ${bySheet["02 Ground Floor"].duplicateOf})`);
  ok(bySheet["02 Ground Floor"].include === false, "duplicate sheet default-excluded");
  ok(bySheet["01 Substructure"].duplicateOf === null && bySheet["01 Substructure"].include === true, "superset stays included");
  ok(bySheet["07 External-MEP"].include === true, "unique bill stays included");
  ok(map.every((e) => !("fps" in e)), "fps stripped from the returned map");
}

// ── Part A: boq_core on the split-rate grid ──────────────────────────────────
{
  const { rows } = annotateGrid(cumulativeSheet);
  const items = rows.filter((r) => r.row_kind === "item");
  ok(items.length === 6, `cumulative: 6 items, got ${items.length}`);
  ok(!items.some((r) => /section total/i.test(r.raw_text)), "SECTION TOTAL never an item");
  ok(rows.filter((r) => r.row_kind === "summary" && /section total/i.test(r.raw_text)).length === 2, "both SECTION TOTALs are summaries");
  const s02 = items.find((r) => r.boq_ref === "S02");
  ok(s02?.rate === 6500 && s02?.rate_material === 0 && s02?.rate_labour === 6500, `labour-only row: all-in 6500 (got ${s02?.rate}), components kept`);
  const g01 = items.find((r) => r.boq_ref === "G01");
  ok(g01?.rate === 184000 && g01?.rate_material === 148000 && g01?.rate_labour === 36000, "split rates: total + components");
  ok(g01?.section_path?.[0]?.includes("GROUND FLOOR WORKS"), `works title promoted to element (got ${JSON.stringify(g01?.section_path)})`);
  const s01 = items.find((r) => r.boq_ref === "S01");
  ok(s01?.section_path?.[0] === "SUBSTRUCTURE WORKS", "first zone element from pre-header title");
  ok(!items.some((r) => r.flags.includes("amount_mismatch")), "qty × all-in rate reconciles to Total Amount");
  const rec = validateAndReconcile(rows).reconciliation;
  ok(rec.item_count === 6 && rec.sections.length === 2, `reconciliation groups by promoted elements (got ${rec.sections.length})`);
}

// ── Part A: boq_core on the working-BOQ grid ─────────────────────────────────
{
  const { rows } = annotateGrid(workingBill);
  const items = rows.filter((r) => r.row_kind === "item");
  ok(items.length === 4, `working bill: 4 items, got ${items.length}`);
  ok(rows.some((r) => r.row_kind === "element_header" && /^BILL 2/.test(r.raw_text)), "BILL title promoted to element");
  ok(rows.some((r) => r.row_kind === "section_header" && r.raw_text === "2.0 Earthworks"), "numbered heading → section");
  ok(rows.filter((r) => r.row_kind === "summary").length >= 3, "subtotals + bill total are summaries");
  const pads = items.find((r) => /pad foundations/i.test(r.raw_text));
  ok(pads?.section_path?.[1]?.startsWith("2.1"), `item nested under numbered section (got ${JSON.stringify(pads?.section_path)})`);
  ok(pads?.rate === 153368 && pads?.rate_material == null, "single-rate bill: no phantom components");
}

// ── Part A: rates + check-sheet parsing ──────────────────────────────────────
{
  const rows = parseRatesSheet(ratesSheet);
  ok(rows.length === 7, `rates: 7 value rows, got ${rows.length}`);
  ok(rows.filter((r) => r.kind === "price").length === 3, "3 material prices");
  ok(rows.filter((r) => r.kind === "labour").length === 2, "2 labour rates");
  ok(rows.filter((r) => r.kind === "buildup").length === 2, "2 build-ups");
  const cement = rows.find((r) => /^Cement/.test(r.label));
  ok(cement?.unit === "bag" && cement?.value === 10500, "cement price parsed");
  const c20 = rows.find((r) => /^C20/.test(r.label));
  ok(c20?.kind === "buildup" && /6.8 bags/.test(c20?.note ?? ""), "build-up keeps its note");

  const sched = parseCheckSheet(materialsSchedule, "reference");
  ok(sched.length === 3, `schedule: 3 check rows, got ${sched.length}`);
  const cem = sched.find((r) => /CEMENT/i.test(r.label));
  ok(cem?.qty === 1821 && cem?.unit === "bags", "cement check value parsed");
  ok(sched.find((r) => /Y16/.test(r.label))?.section?.includes("REINFORCEMENT"), "section attached");

  const sum = parseCheckSheet(summarySheet, "summary");
  const base = sum.find((r) => /BASE CONSTRUCTION COST/i.test(r.label));
  ok(base?.amount === 155709487.06 && base?.qty == null, "summary rows parse as amounts");
}

// ── Part B: the real workbooks (optional gate) ───────────────────────────────
const dir = process.env.VANTARA_BOQ_DIR;
if (dir && fs.existsSync(dir)) {
  const XLSX = await import(pathToFileURL(path.join(root, "apps/web/node_modules/xlsx/xlsx.mjs")).href);
  const load = (file) => {
    const wb = XLSX.read(fs.readFileSync(path.join(dir, file)), { type: "buffer" });
    return wb.SheetNames.map((name) => ({
      name,
      grid: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "", blankrows: true }),
    }));
  };

  // The QS original: cumulative sheet 01 duplicates sheets 02-06; only 01 + 07 import.
  {
    const sheets = load("PRIMEROSE_ESTATE_3FLOORS_MATERIALS_LABOUR_BOQ_ELEME - MR. LAWRENCE.xlsx");
    const map = buildWorkbookMap(sheets);
    const by = Object.fromEntries(map.map((e) => [e.name, e]));
    for (const dup of ["02 Ground Floor", "03 First Floor", "04 Second Floor", "05 Third Floor", "06 Roof-Parapet"]) {
      ok(by[dup]?.duplicateOf === "01 Substructure", `real QS: ${dup} marked duplicate of 01 (got ${by[dup]?.duplicateOf})`);
    }
    ok(by["01 Substructure"]?.include === true && by["07 External-MEP"]?.include === true, "real QS: import set = 01 + 07");
    ok(by["01 Substructure"]?.hasSplitRates === true, "real QS: split rates detected");
    ok(by["Rebar Summary"]?.role === "reference" && by["Executive Summary"]?.role === "summary" && by["Basis & Assumptions"]?.role === "notes", "real QS: non-bill roles");
    // The cumulative sheet must reconcile against its own SECTION TOTALs.
    const grid = trimGrid(sheets.find((s) => s.name === "01 Substructure").grid);
    const out = validateAndReconcile(annotateGrid(grid).rows);
    ok(out.reconciliation.sections.length >= 6, `real QS: ≥6 element zones (got ${out.reconciliation.sections.length})`);
    const bad = out.reconciliation.sections.filter((s) => s.stated != null && !s.ok);
    ok(bad.length === 0, `real QS: every zone cross-casts (${bad.length} off: ${bad.map((b) => b.element).join("; ")})`);
  }

  // The working BOQ: 9 bills, rates sheet, schedule, summary — no duplicates.
  {
    const sheets = load("PRIMROSE_G3_WORKING_BOQ.xlsx");
    const map = buildWorkbookMap(sheets);
    const by = Object.fromEntries(map.map((e) => [e.name, e]));
    const bills = map.filter((e) => e.role === "bill");
    ok(bills.length === 9, `real working BOQ: 9 bill sheets (got ${bills.length}: ${bills.map((b) => b.name).join(", ")})`);
    ok(bills.every((b) => b.duplicateOf === null), "real working BOQ: no false duplicates");
    ok(by["Rates & Inputs"]?.role === "rates", "real working BOQ: rates sheet");
    ok(by["Materials Schedule"]?.role === "reference", "real working BOQ: schedule");
    ok(by["Summary"]?.role === "summary" && by["Assumptions & Exclusions"]?.role === "notes", "real working BOQ: summary/notes");
    const rates = parseRatesSheet(sheets.find((s) => s.name === "Rates & Inputs").grid);
    ok(rates.filter((r) => r.kind === "price").length >= 20, `real working BOQ: ≥20 input prices (got ${rates.filter((r) => r.kind === "price").length})`);
    const sched = parseCheckSheet(sheets.find((s) => s.name === "Materials Schedule").grid, "reference");
    ok(sched.some((r) => r.qty === 1821), "real working BOQ: 1,821 cement bags check value");
  }
  console.log("boq_workbook: PART B (real files) ran");
} else {
  console.log("boq_workbook: PART B SKIPPED (set VANTARA_BOQ_DIR to run against the real workbooks)");
}

if (fails) { console.error(`boq_workbook: ${fails} FAILURE(S)`); process.exit(1); }
console.log("boq_workbook: ALL PASS");
