"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Org = { org_id: string; org_name: string; role: string; is_active_org: boolean };

// Switch the active org: fn_set_active_org records it, then we refresh the session
// so the NEW token carries the new active_org_id (via the A0 hook). Reload to
// re-fetch everything under the new org's RLS scope.
export function OrgSwitcher({ orgs }: { orgs: Org[] }) {
  const router = useRouter();
  const supabase = createClient();
  const active = orgs.find((o) => o.is_active_org);
  const [busy, setBusy] = useState(false);

  async function switchTo(orgId: string) {
    if (busy || orgId === active?.org_id) return;
    setBusy(true);
    const { error } = await supabase.rpc("fn_set_active_org", { p_org: orgId });
    if (!error) await supabase.auth.refreshSession();
    setBusy(false);
    if (!error) router.refresh();
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="flex items-center gap-3">
      <select
        className="rounded-md border border-neutral-300 px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        value={active?.org_id ?? ""}
        disabled={busy || orgs.length === 0}
        onChange={(e) => switchTo(e.target.value)}
      >
        {orgs.length === 0 && <option value="">No orgs</option>}
        {orgs.map((o) => (
          <option key={o.org_id} value={o.org_id}>
            {o.org_name} ({o.role})
          </option>
        ))}
      </select>
      <button className="text-sm text-neutral-500 underline" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
}
