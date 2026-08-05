// Unit normalization (mirror of SQL fn_normalize_unit / boq_core UNIT_MAP).
// Used by the assembly unit guard: a per-m³ mix must never attach to a per-m²
// line (the ₦82.96m render incident, DECISIONS #72). Unknown units normalize to
// null and are tolerated — refuse only what is provably wrong.
const MAP: Record<string, string> = {
  m2: "m2", sqm: "m2", sm: "m2", "m²": "m2",
  m3: "m3", cum: "m3", "m³": "m3",
  t: "t", ton: "t", tons: "t", ttons: "t", tonne: "t", tonnes: "t",
  nr: "nr", nrs: "nr", no: "nr", nos: "nr", number: "nr",
  m: "m", lm: "m", linm: "m",
  item: "item", ltem: "item", itm: "item",
  kg: "kg", bag: "bag", bags: "bag", set: "set", sets: "set",
  sum: "sum", ls: "sum", pair: "pair", pairs: "pair",
};

export function normUnit(u: string | null | undefined): string | null {
  if (!u) return null;
  return MAP[u.toLowerCase().replace(/[\s.,]/g, "")] ?? null;
}

/** True only when BOTH units are known and provably different. */
export function unitsClash(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normUnit(a), y = normUnit(b);
  return x != null && y != null && x !== y;
}
