-- M8 · Project management write-path (SECURITY DEFINER).
-- Projects have SELECT-only RLS (projects_select). Like every other write in SiteLens,
-- creating/renaming/archiving a project goes through a SECURITY DEFINER function that
-- re-derives the org from the caller's token (current_org_id()) and checks the caller is
-- an admin or PM of that org — never a direct client insert. New projects are org-scoped
-- automatically, so tenant + project isolation (has_project_access) applies with no extra
-- work. Not a financial table, so no idempotency_key column; the client-generated UUID PK
-- makes create idempotent under retry.

-- Guard: caller must be an active admin/PM of the current org. Returns the org id.
CREATE OR REPLACE FUNCTION fn_require_project_admin() RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  v_org := current_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no active organisation on this session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = auth.uid() AND m.org_id = v_org
      AND m.is_active AND m.role IN ('admin','pm')
  ) THEN
    RAISE EXCEPTION 'only an admin or PM can manage projects';
  END IF;
  RETURN v_org;
END;
$$;

CREATE OR REPLACE FUNCTION fn_create_project(
  p_id          UUID,
  p_name        TEXT,
  p_location    TEXT    DEFAULT NULL,
  p_budget      NUMERIC DEFAULT NULL,
  p_start       DATE    DEFAULT NULL,
  p_target_end  DATE    DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  v_org := fn_require_project_admin();
  IF coalesce(btrim(p_name),'') = '' THEN
    RAISE EXCEPTION 'project name is required';
  END IF;

  INSERT INTO projects (id, org_id, name, location_text, total_budget,
                        start_date, target_end_date, status, created_by)
  VALUES (p_id, v_org, btrim(p_name), p_location, p_budget,
          p_start, p_target_end, 'active', auth.uid())
  ON CONFLICT (id) DO NOTHING;  -- idempotent retry on the client-generated PK

  RETURN p_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_rename_project(p_project UUID, p_name TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  v_org := fn_require_project_admin();
  IF coalesce(btrim(p_name),'') = '' THEN
    RAISE EXCEPTION 'project name is required';
  END IF;
  UPDATE projects SET name = btrim(p_name)
   WHERE id = p_project AND org_id = v_org AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found in this organisation';
  END IF;
END;
$$;

-- Archive (soft-delete). Financial FKs are ON DELETE RESTRICT, so projects are never
-- hard-deleted — archiving just hides it from the active lists.
CREATE OR REPLACE FUNCTION fn_archive_project(p_project UUID, p_archive BOOLEAN DEFAULT TRUE)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  v_org := fn_require_project_admin();
  UPDATE projects
     SET archived_at = CASE WHEN p_archive THEN NOW() ELSE NULL END,
         status      = CASE WHEN p_archive THEN 'archived' ELSE 'active' END
   WHERE id = p_project AND org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found in this organisation';
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION fn_require_project_admin()                     FROM anon, public;
REVOKE EXECUTE ON FUNCTION fn_create_project(uuid,text,text,numeric,date,date) FROM anon, public;
REVOKE EXECUTE ON FUNCTION fn_rename_project(uuid,text)                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION fn_archive_project(uuid,boolean)              FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_create_project(uuid,text,text,numeric,date,date) TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_rename_project(uuid,text)                   TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_archive_project(uuid,boolean)              TO authenticated;
