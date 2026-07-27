-- M1 · A0 — Auth token hook: make real Supabase Auth logins carry the RLS claim.
--
-- RLS gates on request.jwt.claims.active_org_id (M0). With real GoTrue logins (not
-- M0's hand-minted JWTs), something must inject that claim at token-issue time.
-- Supabase's Custom Access Token Hook calls a Postgres function on every token
-- issue/refresh; we use it to add `active_org_id`, `user_role`, `membership_id`.
--
-- "Which org is active" is stored per user in `active_org`; switching org updates it
-- and the client refreshes its session to get a new token via this hook.

-- ── which org the user is currently acting as ───────────────────────────────
CREATE TABLE active_org (
  user_id       UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE active_org ENABLE ROW LEVEL SECURITY;
-- A user may read only their own active-org row. No client write policy — the only
-- write path is fn_set_active_org (which validates membership). Consistent with M0.
CREATE POLICY active_org_select ON active_org FOR SELECT USING (user_id = auth.uid());
GRANT SELECT ON active_org TO authenticated;

-- ── the access-token hook ───────────────────────────────────────────────────
-- SECURITY DEFINER (owner = postgres, the table owner) so it can read memberships/
-- active_org regardless of RLS. GoTrue invokes it as supabase_auth_admin, which only
-- needs EXECUTE. Picks the explicitly-set active membership, else the earliest active
-- membership (so a brand-new user with one org "just works" before any switch).
CREATE OR REPLACE FUNCTION custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claims jsonb := COALESCE(event->'claims', '{}'::jsonb);
  v_uid  uuid  := (event->>'user_id')::uuid;
  v_mem  RECORD;
BEGIN
  SELECT m.id AS membership_id, m.org_id, m.role
    INTO v_mem
  FROM memberships m
  LEFT JOIN active_org a ON a.user_id = m.user_id AND a.membership_id = m.id
  WHERE m.user_id = v_uid AND m.is_active
  ORDER BY (a.user_id IS NOT NULL) DESC, m.created_at ASC
  LIMIT 1;

  IF v_mem.org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{active_org_id}', to_jsonb(v_mem.org_id));
    claims := jsonb_set(claims, '{user_role}',     to_jsonb(v_mem.role));
    claims := jsonb_set(claims, '{membership_id}', to_jsonb(v_mem.membership_id));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

-- Only GoTrue may run the hook.
REVOKE EXECUTE ON FUNCTION custom_access_token_hook(jsonb) FROM authenticated, anon, public;
GRANT  EXECUTE ON FUNCTION custom_access_token_hook(jsonb) TO supabase_auth_admin;
-- GoTrue reads these while running the hook as supabase_auth_admin.
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT SELECT ON active_org, memberships TO supabase_auth_admin;

-- ── org switch (the only write path into active_org) ────────────────────────
-- Validates the caller is an active member of the target org, then upserts.
-- After calling this, the client MUST refresh its session so the new token carries
-- the new active_org_id (via the hook above).
CREATE OR REPLACE FUNCTION fn_set_active_org(p_org uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mem uuid;
BEGIN
  SELECT id INTO v_mem
  FROM memberships
  WHERE user_id = auth.uid() AND org_id = p_org AND is_active;

  IF v_mem IS NULL THEN
    RAISE EXCEPTION 'not an active member of org %', p_org USING errcode = '42501';
  END IF;

  INSERT INTO active_org (user_id, membership_id)
  VALUES (auth.uid(), v_mem)
  ON CONFLICT (user_id) DO UPDATE
    SET membership_id = EXCLUDED.membership_id, updated_at = NOW();
END;
$$;
REVOKE EXECUTE ON FUNCTION fn_set_active_org(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_active_org(uuid) TO authenticated;

-- ── list the orgs the current user can act as (for the org switcher) ────────
-- SECURITY DEFINER because the memberships RLS policy only exposes the CURRENT
-- org's rows — a user must still be able to enumerate the other orgs they belong
-- to in order to switch. Scoped strictly to auth.uid()'s own active memberships.
CREATE OR REPLACE FUNCTION fn_my_orgs()
RETURNS TABLE (org_id uuid, org_name text, role org_role, is_active_org boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id,
         o.name::text,
         m.role,
         (m.id = (SELECT membership_id FROM active_org WHERE user_id = auth.uid())) AS is_active_org
  FROM memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.is_active
  ORDER BY o.name;
$$;
REVOKE EXECUTE ON FUNCTION fn_my_orgs() FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_my_orgs() TO authenticated;
