import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPriceForm } from "@/components/SetPriceForm";

function activeOrgFromSession(accessToken: string | undefined): string {
  if (!accessToken) return "";
  try {
    const [, payload] = accessToken.split(".");
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).active_org_id ?? "";
  } catch {
    return "";
  }
}

// Price list editor. Reads are RLS-scoped to the active org; the only WRITE path is
// fn_set_material_price (Rule 1) — the form calls that RPC, never a direct insert.
export default async function PricesPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromSession(sessionRes.session?.access_token);

  const today = new Date().toISOString().slice(0, 10);
  const { data: materials } = await supabase
    .from("materials_catalog")
    .select("id,name,unit")
    .order("name");
  const { data: priceRows } = await supabase
    .from("material_prices")
    .select("material_id,unit_price,effective_from")
    .lte("effective_from", today)
    .order("effective_from", { ascending: false });

  // Current price = latest effective_from <= today per material.
  const current = new Map<string, number>();
  for (const r of priceRows ?? []) {
    if (!current.has(r.material_id)) current.set(r.material_id, Number(r.unit_price));
  }

  return (
    <main className="space-y-6">
      <h1 className="text-xl font-semibold">Price list</h1>
      <p className="text-sm text-neutral-500">
        Prices are dated and append-only — a change is a new row, never an overwrite.
        Cost anywhere = quantity × current price, computed live.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left dark:border-neutral-800">
            <th className="py-2">Material</th>
            <th>Unit</th>
            <th className="text-right">Current price (₦)</th>
          </tr>
        </thead>
        <tbody>
          {(materials ?? []).map((m) => (
            <tr key={m.id} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2">{m.name}</td>
              <td className="text-neutral-500">{m.unit}</td>
              <td className="text-right font-mono">
                {current.has(m.id) ? current.get(m.id)!.toLocaleString() : "—"}
              </td>
            </tr>
          ))}
          {(materials ?? []).length === 0 && (
            <tr><td colSpan={3} className="py-3 text-neutral-500">No materials in this org yet.</td></tr>
          )}
        </tbody>
      </table>

      <SetPriceForm orgId={orgId} materials={materials ?? []} today={today} />
    </main>
  );
}
