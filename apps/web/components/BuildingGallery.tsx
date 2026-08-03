import { createClient } from "@/lib/supabase/server";

type MediaRow = {
  id: string; key_thumb: string | null; key_display: string | null;
  captured_at: string | null; within_geofence: boolean | null; mock_location: boolean | null;
};

// The building's photo gallery (Phase D) — the client-trust surface. Photos come
// from the field app (in-app capture only, stamped); we read RLS-scoped media
// rows and sign 15-minute URLs (SEC: private bucket, opaque keys). Newest first.
// Server component: URLs are minted per page view, never stored.
export async function BuildingGallery({ buildingId }: { buildingId: string }) {
  const supabase = createClient();
  const { data } = await supabase
    .from("media")
    .select("id,key_thumb,key_display,captured_at,within_geofence,mock_location")
    .eq("building_id", buildingId)
    .not("key_thumb", "is", null)
    .order("captured_at", { ascending: false })
    .limit(24);

  const rows = (data ?? []) as MediaRow[];
  if (rows.length === 0) {
    return (
      <section className="card">
        <h2 className="text-sm font-semibold text-white">Photos</h2>
        <p className="mt-2 text-sm text-[#8b95a7]">
          No photos yet — they appear here the moment the site engineer&apos;s daily report lands.
        </p>
      </section>
    );
  }

  const keys = rows.flatMap((r) => [r.key_thumb!, ...(r.key_display ? [r.key_display] : [])]);
  const { data: signed } = await supabase.storage.from("report-media").createSignedUrls(keys, 900);
  const urlOf = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short" }) : "";

  return (
    <section className="card">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-white">Photos</h2>
        <span className="text-xs text-[#8b95a7]">{rows.length} from the field · newest first</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {rows.map((m) => {
          const thumb = m.key_thumb ? urlOf.get(m.key_thumb) : undefined;
          const display = m.key_display ? urlOf.get(m.key_display) : undefined;
          if (!thumb) return null;
          const flagged = m.within_geofence === false || m.mock_location === true;
          return (
            <a key={m.id} href={display ?? thumb} target="_blank" rel="noreferrer"
              className="group relative block overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={thumb} alt="site photo" loading="lazy"
                className="aspect-square w-full object-cover transition group-hover:scale-[1.03] group-hover:opacity-90" />
              <span className="absolute bottom-1 left-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] text-[#c7cedb]">
                {fmt(m.captured_at)}
              </span>
              {flagged && (
                <span className="absolute right-1 top-1 rounded-md bg-amber-500/80 px-1.5 py-0.5 text-[10px] font-semibold text-black">
                  check location
                </span>
              )}
            </a>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-[#5b6473]">
        Captured in-app only, stamped with GPS + time. Links expire after 15 minutes.
      </p>
    </section>
  );
}
