-- Recipe cover photo (founder feedback, 2026-08-04): a render/elevation image on
-- the building type, shown on the recipe library cards and the recipe header so
-- you can SEE what the structure will look like. One display image — this is a
-- design asset, not site media, so the three-derivative photo pipeline (PRD §5.3)
-- does not apply. Keys are opaque `<org_id>/<uuid>.<ext>` (SEC-10), served via
-- 15-minute signed URLs; write path is a SECURITY DEFINER fn (Rule 1 pattern).

INSERT INTO storage.buckets (id, name, public)
VALUES ('type-covers', 'type-covers', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS type_covers_read   ON storage.objects;
DROP POLICY IF EXISTS type_covers_insert ON storage.objects;

CREATE POLICY type_covers_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'type-covers'
         AND (storage.foldername(name))[1] = current_org_id()::text);

CREATE POLICY type_covers_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'type-covers'
              AND (storage.foldername(name))[1] = current_org_id()::text);

ALTER TABLE building_types ADD COLUMN cover_key TEXT;

-- Set (or clear, p_key NULL) a recipe's cover. The key must live under the org's
-- own prefix — a manager can never point their recipe at another org's object.
CREATE OR REPLACE FUNCTION fn_set_type_cover(p_type uuid, p_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT org_id INTO v_org FROM building_types WHERE id = p_type;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  PERFORM fn_require_org_manager(v_org);
  IF p_key IS NOT NULL AND split_part(p_key, '/', 1) <> v_org::text THEN
    RAISE EXCEPTION 'cover key must be under the org''s own prefix' USING errcode = '42501';
  END IF;
  UPDATE building_types SET cover_key = p_key WHERE id = p_type;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'set_type_cover', 'building_types', p_type,
          jsonb_build_object('cover_key', p_key));
END $$;
REVOKE EXECUTE ON FUNCTION fn_set_type_cover(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_type_cover(uuid, text) TO authenticated;
