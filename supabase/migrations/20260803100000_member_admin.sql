-- Member administration — invite / list / deactivate org members.
-- Pulled forward from the deferred [LATER] "account administration" bucket at the
-- founder's request (see docs/DECISIONS.md #66). Scope: invite + list + deactivate.
--
-- Security follows the house pattern (cf. projects_write_fns): every mutation is a
-- SECURITY DEFINER function that re-derives the org from the caller's token
-- (current_org_id()) and requires the caller be an ACTIVE ADMIN of that org — never a
-- direct client insert into memberships. Because the org is taken from the caller's
-- JWT and never from a parameter, an admin of Org A structurally cannot grant into
-- Org B (there is no org argument to abuse). memberships has SELECT-only RLS already.
--
-- The auth.users row itself is minted by the invite-member Edge Function using the
-- service role (admin API) — SQL can't create a GoTrue user. These functions take the
-- resulting uid and wire up app_users + memberships. app_users has no FK to auth by
-- design (core_tenancy), so id is a mirrored UUID, not an enforced reference.

-- ── phone becomes optional ──────────────────────────────────────────────────
-- Members are invited by EMAIL and have no phone. phone stays UNIQUE (Postgres treats
-- NULLs as distinct, so many email-only members coexist); we only drop NOT NULL.
ALTER TABLE app_users ALTER COLUMN phone DROP NOT NULL;

-- ── guard: caller must be an active admin of their current org; returns org id ──
CREATE OR REPLACE FUNCTION fn_require_org_admin() RETURNS UUID
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
      AND m.is_active AND m.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'only an admin can manage members' USING errcode = '42501';
  END IF;
  RETURN v_org;
END;
$$;

-- ── resolve an existing GoTrue user id by email (admin-only) ─────────────────
-- Lets the Edge Function make invites idempotent: if the email already has an auth
-- user (re-invite, or an existing member of another org), reuse it instead of a
-- failing createUser. SECURITY DEFINER (owner = postgres) to read auth.users; gated to
-- admins so it is not an email→account oracle for arbitrary callers. Returns NULL if
-- no such user.
CREATE OR REPLACE FUNCTION fn_auth_uid_by_email(p_email TEXT) RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid UUID;
BEGIN
  PERFORM fn_require_org_admin();               -- authorize the caller
  SELECT id INTO v_uid FROM auth.users
   WHERE lower(email) = lower(btrim(p_email))
   ORDER BY created_at ASC LIMIT 1;
  RETURN v_uid;
END;
$$;

-- ── add (or reactivate / re-role) a member (admin-only) ─────────────────────
-- p_user is the auth.users id the Edge Function created or resolved. Idempotent:
-- re-inviting the same email updates the role and reactivates rather than duplicating
-- (UNIQUE(org_id,user_id)). Returns the membership id.
CREATE OR REPLACE FUNCTION fn_add_member(
  p_user  UUID,
  p_email TEXT,
  p_name  TEXT,
  p_role  org_role
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org UUID;
  v_mem UUID;
BEGIN
  v_org := fn_require_org_admin();
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'user id is required';
  END IF;

  -- Global identity row (mirrors auth.users.id). Fill name/email if we have them,
  -- never blank out a value already present from another org membership.
  INSERT INTO app_users (id, full_name, email)
  VALUES (p_user,
          COALESCE(NULLIF(btrim(p_name), ''), NULLIF(btrim(p_email), ''), 'Member'),
          NULLIF(btrim(p_email), ''))
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(NULLIF(btrim(EXCLUDED.full_name), ''), app_users.full_name),
        email     = COALESCE(EXCLUDED.email, app_users.email);

  -- Membership in the caller's org.
  INSERT INTO memberships (org_id, user_id, role, is_active)
  VALUES (v_org, p_user, p_role, TRUE)
  ON CONFLICT (org_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, is_active = TRUE, deactivated_at = NULL
  RETURNING id INTO v_mem;

  -- Notify the invitee via the same dev-outbox abstraction the portal uses.
  IF NULLIF(btrim(p_email), '') IS NOT NULL THEN
    PERFORM fn_notify(v_org, 'email', btrim(p_email), 'member_invite',
                      jsonb_build_object('name', p_name, 'role', p_role::text));
  END IF;

  RETURN v_mem;
END;
$$;

-- ── deactivate / reactivate a member (admin-only) ───────────────────────────
-- Deactivation is soft (is_active = FALSE) — memberships are never hard-deleted
-- (financial FKs are ON DELETE RESTRICT). Two lock-out guards: you cannot deactivate
-- your own membership, and you cannot remove the last active admin of the org.
CREATE OR REPLACE FUNCTION fn_set_member_active(p_membership UUID, p_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org       UUID;
  v_target    RECORD;
  v_admin_cnt INT;
BEGIN
  v_org := fn_require_org_admin();

  SELECT user_id, role, is_active INTO v_target
  FROM memberships WHERE id = p_membership AND org_id = v_org;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'member not found in this organisation';
  END IF;

  IF p_active IS FALSE THEN
    IF v_target.user_id = auth.uid() THEN
      RAISE EXCEPTION 'you cannot deactivate your own membership' USING errcode = '42501';
    END IF;
    IF v_target.role = 'admin' THEN
      SELECT count(*) INTO v_admin_cnt
      FROM memberships WHERE org_id = v_org AND role = 'admin' AND is_active;
      IF v_admin_cnt <= 1 THEN
        RAISE EXCEPTION 'cannot deactivate the last active admin';
      END IF;
    END IF;
  END IF;

  UPDATE memberships
     SET is_active = p_active,
         deactivated_at = CASE WHEN p_active THEN NULL ELSE NOW() END
   WHERE id = p_membership AND org_id = v_org;
END;
$$;

-- ── roster for the admin UI ─────────────────────────────────────────────────
-- Any active member may read their org's roster (benign, and useful). SECURITY
-- DEFINER to join app_users regardless of that table's RLS and return exactly the
-- columns the UI needs. is_self lets the UI disable the self-deactivate control.
CREATE OR REPLACE FUNCTION fn_org_members()
RETURNS TABLE (
  membership_id UUID,
  user_id       UUID,
  full_name     TEXT,
  email         TEXT,
  role          org_role,
  is_active     BOOLEAN,
  is_self       BOOLEAN,
  created_at    TIMESTAMPTZ
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org UUID;
BEGIN
  v_org := current_org_id();
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no active organisation on this session';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.user_id = auth.uid() AND m.org_id = v_org AND m.is_active
  ) THEN
    RAISE EXCEPTION 'not a member of this organisation' USING errcode = '42501';
  END IF;

  RETURN QUERY
  SELECT m.id, m.user_id, u.full_name::text, u.email::text, m.role, m.is_active,
         (m.user_id = auth.uid()) AS is_self, m.created_at
  FROM memberships m
  JOIN app_users u ON u.id = m.user_id
  WHERE m.org_id = v_org
  ORDER BY m.is_active DESC, u.full_name;
END;
$$;

-- ── grants ──────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION fn_require_org_admin()                       FROM anon, public;
REVOKE EXECUTE ON FUNCTION fn_auth_uid_by_email(text)                   FROM anon, public;
REVOKE EXECUTE ON FUNCTION fn_add_member(uuid, text, text, org_role)    FROM anon, public;
REVOKE EXECUTE ON FUNCTION fn_set_member_active(uuid, boolean)          FROM anon, public;
REVOKE EXECUTE ON FUNCTION fn_org_members()                             FROM anon, public;
-- fn_require_org_admin is granted to authenticated too: the invite-member Edge Function
-- calls it directly (as the caller) to authorise BEFORE creating an auth user, so a
-- rejected non-admin never leaves an orphan GoTrue user behind.
GRANT  EXECUTE ON FUNCTION fn_require_org_admin()                       TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_auth_uid_by_email(text)                   TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_add_member(uuid, text, text, org_role)    TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_set_member_active(uuid, boolean)          TO authenticated;
GRANT  EXECUTE ON FUNCTION fn_org_members()                             TO authenticated;
