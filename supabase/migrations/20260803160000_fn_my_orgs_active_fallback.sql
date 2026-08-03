-- Harden fn_my_orgs: is_active_org must not require an explicit active_org row.
--
-- Bug (found in the pilot): the admin gate (web Shell + the /team page) keys off
-- fn_my_orgs.is_active_org, which was TRUE only when the user had an active_org row —
-- and that row is written solely by fn_set_active_org (the org switcher). A single-org
-- user (the founder, and every freshly-invited user) has no such row and cannot switch,
-- so is_active_org was FALSE for their only org. They then read as "no active org" and
-- admin-only UI (the Team nav item / page) stayed hidden, even though RLS scoped them
-- correctly the whole time via the JWT's active_org_id (set by the custom access-token
-- hook, which already falls back to the earliest membership).
--
-- Fix: when there is no explicit active_org row, fall back to the membership matching
-- the session's active org — current_org_id(), the same JWT claim every RLS policy
-- uses. Now the UI's notion of "which org am I acting as, and my role there" agrees
-- with what the database enforces. No behaviour change for users who HAVE switched org
-- (the explicit active_org row still wins via COALESCE).
CREATE OR REPLACE FUNCTION fn_my_orgs()
RETURNS TABLE (org_id uuid, org_name text, role org_role, is_active_org boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT o.id,
         o.name::text,
         m.role,
         (m.id = COALESCE(
            (SELECT membership_id FROM active_org WHERE user_id = auth.uid()),
            (SELECT m2.id FROM memberships m2
              WHERE m2.user_id = auth.uid()
                AND m2.org_id = current_org_id()
                AND m2.is_active
              ORDER BY m2.created_at
              LIMIT 1)
         )) AS is_active_org
  FROM memberships m
  JOIN organizations o ON o.id = m.org_id
  WHERE m.user_id = auth.uid() AND m.is_active
  ORDER BY o.name;
$$;
