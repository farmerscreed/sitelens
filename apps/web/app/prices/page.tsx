import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SetPriceForm } from "@/components/SetPriceForm";
import { PageHeader } from "@/components/PageHeader";

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
    <div className="space-y-6">
      <PageHeader
        title="Price list"
        subtitle="Prices are dated and append-only — a change is a new row, never an overwrite. Cost anywhere = quantity × current price, computed live." />

      <div className="card p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Material</th>
                <th>Unit</th>
                <th className="text-right">Current price (₦)</th>
              </tr>
            </thead>
            <tbody>
              {(materials ?? []).map((m) => (
                <tr key={m.id}>
                  <td className="font-medium text-white">{m.name}</td>
                  <td className="text-[#8b95a7]">{m.unit}</td>
                  <td className="text-right font-mono">
                    {current.has(m.id) ? current.get(m.id)!.toLocaleString() : <span className="text-[#5b6473]">—</span>}
                  </td>
                </tr>
              ))}
              {(materials ?? []).length === 0 && (
                <tr><td colSpan={3} className="py-6 text-center text-[#8b95a7]">No materials in this org yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <SetPriceForm orgId={orgId} materials={materials ?? []} today={today} />
    </div>
  );
}
