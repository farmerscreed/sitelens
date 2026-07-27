-- M1 · C — Private bucket for BOQ source files (F-BOQ-5: raw xlsx/pdf retained).
-- Buckets are private; access is org-scoped by object path `<org_id>/<uuid>` and
-- served via short-lived signed URLs (SEC-10). Storage is behind an adapter in the
-- app (Supabase Storage locally; Cloudflare R2 in prod — CLOUD_MIGRATION.md).

INSERT INTO storage.buckets (id, name, public)
VALUES ('boq-sources', 'boq-sources', false)
ON CONFLICT (id) DO NOTHING;

-- Org-scoped access on this bucket: the first path segment must equal the caller's
-- active org. RLS on storage.objects is already enabled by Supabase.
DROP POLICY IF EXISTS boq_sources_read   ON storage.objects;
DROP POLICY IF EXISTS boq_sources_insert ON storage.objects;

CREATE POLICY boq_sources_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'boq-sources'
         AND (storage.foldername(name))[1] = current_org_id()::text);

CREATE POLICY boq_sources_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'boq-sources'
              AND (storage.foldername(name))[1] = current_org_id()::text);
