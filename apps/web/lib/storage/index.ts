import type { SupabaseClient } from "@supabase/supabase-js";

// One storage interface (PRD §5.1). Local = Supabase Storage; production swaps to
// Cloudflare R2 with no app changes — only STORAGE_PROVIDER + keys differ. App code
// calls this interface, never a provider SDK directly.
export interface StorageAdapter {
  put(key: string, file: Blob, contentType?: string): Promise<{ key: string }>;
  getSignedUrl(key: string, expiresInSec?: number): Promise<string>;
  remove(key: string): Promise<void>;
}

const BUCKET = "boq-sources";
const DEFAULT_TTL = 15 * 60; // 15 min (SEC-10)

// Supabase Storage implementation. RLS on storage.objects scopes access by the
// `<org_id>/…` path prefix, so a caller can only touch their org's objects.
function supabaseAdapter(client: SupabaseClient): StorageAdapter {
  return {
    async put(key, file, contentType) {
      const { error } = await client.storage
        .from(BUCKET)
        .upload(key, file, { contentType, upsert: false });
      if (error) throw error;
      return { key };
    },
    async getSignedUrl(key, expiresInSec = DEFAULT_TTL) {
      const { data, error } = await client.storage.from(BUCKET).createSignedUrl(key, expiresInSec);
      if (error) throw error;
      return data.signedUrl;
    },
    async remove(key) {
      const { error } = await client.storage.from(BUCKET).remove([key]);
      if (error) throw error;
    },
  };
}

// r2Adapter is added at cloud-move time (S3-compatible). Kept as a clear seam.
export function createStorage(client: SupabaseClient): StorageAdapter {
  const provider = process.env.STORAGE_PROVIDER ?? "supabase";
  if (provider === "supabase") return supabaseAdapter(client);
  throw new Error(`storage provider '${provider}' not wired yet (see CLOUD_MIGRATION.md)`);
}

// Object key convention: <org_id>/<uuid>.<ext> — the org prefix is what the storage
// RLS policy checks.
export function boqObjectKey(orgId: string, uuid: string, ext: string): string {
  return `${orgId}/${uuid}.${ext.replace(/^\./, "")}`;
}
