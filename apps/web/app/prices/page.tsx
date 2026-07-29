import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PricesManager } from "@/components/PricesManager";
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

// Price list. Reads RLS-scoped to the active org. Writes go only through the server
// functions (Rule 1): fn_set_material_price (set/edit) and fn_delete_material_price.
export default async function PricesPage() {
  const supabase = createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) redirect("/login");
  const { data: sessionRes } = await supabase.auth.getSession();
  const orgId = activeOrgFromSession(sessionRes.session?.access_token);

  const today = new Date().toISOString().slice(0, 10);
  const { data: materials } = await supabase
    .from("materials_catalog").select("id,name,unit").is("archived_at", null).order("name");
  const { data: priceRows } = await supabase
    .from("material_prices").select("id,material_id,unit_price,effective_from")
    .order("effective_from", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Price list"
        subtitle="Dated and append-only — a change adds a new row, never an overwrite. Cost anywhere = quantity × current price, computed live. Editing today's price corrects it in place; delete removes a wrong entry."
        info={{
          what: "The market price of every material, by date. Quantities live on recipes; prices live here. Every cost in the app is computed live as quantity × current price, so updating a price instantly re-costs every recipe, building and plan.",
          steps: [
            "Set a price: type the new unit price and the date it takes effect, then Save.",
            "Correcting today's price? Save again with today's date — it updates in place.",
            "Open 'Price history' to see past prices, or delete a wrong entry (Admin only).",
          ],
        }} />
      <PricesManager
        orgId={orgId}
        today={today}
        materials={materials ?? []}
        prices={(priceRows ?? []).map((p) => ({ ...p, unit_price: Number(p.unit_price) }))}
      />
    </div>
  );
}
