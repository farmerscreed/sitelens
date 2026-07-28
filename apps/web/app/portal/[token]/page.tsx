import { PortalView } from "@/components/PortalView";

// PUBLIC page (no login). The client enters the PIN; fn_portal_view (anon, token-keyed)
// verifies, logs the access, and returns a safe read-only view.
export default function PortalPage({ params }: { params: { token: string } }) {
  return (
    <main className="mx-auto max-w-lg space-y-4 py-6">
      <PortalView token={params.token} />
    </main>
  );
}
