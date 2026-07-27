-- M0 · SECURITY DEFINER / helper functions
-- (SiteLens_PRD_v2.md §10.3 + PRD.md §16.5)
-- These are the read-side helpers that RLS policies gate on. Write-side
-- SECURITY DEFINER functions (fn_*) arrive in M1+; M0 only stands up the guards.

-- Helper: current user's org from JWT (request.jwt.claims.active_org_id)
CREATE OR REPLACE FUNCTION current_org_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claims', true)::jsonb ->> 'active_org_id','')::uuid;
$$;

CREATE OR REPLACE FUNCTION current_membership_id() RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT m.id FROM memberships m
  WHERE m.user_id = auth.uid() AND m.org_id = current_org_id() AND m.is_active;
$$;

-- SECURITY DEFINER so the access check reads projects/memberships/project_members
-- without being blocked by (or recursing into) their own RLS policies.
CREATE OR REPLACE FUNCTION has_project_access(p_project UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM projects p
    JOIN memberships m ON m.org_id = p.org_id
    WHERE p.id = p_project
      AND m.user_id = auth.uid()
      AND m.is_active
      AND m.org_id = current_org_id()
      AND (m.role IN ('admin','pm') OR EXISTS (
            SELECT 1 FROM project_members pm
            WHERE pm.project_id = p.id AND pm.membership_id = m.id))
  );
$$;

-- Current price of a material (Rule 4: cost = quantity × current price, computed live).
CREATE OR REPLACE FUNCTION current_price(p_org UUID, p_material UUID)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT unit_price FROM material_prices
  WHERE org_id = p_org AND material_id = p_material AND effective_from <= CURRENT_DATE
  ORDER BY effective_from DESC LIMIT 1;
$$;
