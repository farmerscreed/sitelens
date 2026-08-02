-- Client-facing standardized milestones (founder pilot, 2026-08-02; research-backed).
-- The 15 QS stages are too granular for clients; roll them into ~6 milestones buyers
-- recognise (BuildWatch/global practice: Foundation, Structure/Framing, Roofing, Walls &
-- openings, Services/MEP, Finishes) + Handover as the completed state. milestone lives on
-- type_stages (editable per recipe, manager-gated), auto-mapped from the stage name by
-- default. Progress is DERIVED from stage completion (no new source of truth); the overall
-- client % uses earned value (cost-weighted), computed elsewhere.

ALTER TABLE type_stages ADD COLUMN IF NOT EXISTS milestone TEXT;

-- Name → default milestone (precedence: finishes before walls, so "Wall Finishings"
-- → Finishes but "Walls" → Walls & openings).
CREATE OR REPLACE FUNCTION fn__default_milestone(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_name ILIKE '%substruct%' OR p_name ILIKE '%foundation%'                       THEN 'Foundation'
    WHEN p_name ILIKE '%finish%' OR p_name ILIKE '%paint%' OR p_name ILIKE '%fitting%'
      OR p_name ILIKE '%ceiling%' OR p_name ILIKE '%decor%'                              THEN 'Finishes'
    WHEN p_name ILIKE '%roof%'                                                           THEN 'Roofing'
    WHEN p_name ILIKE '%mechanic%' OR p_name ILIKE '%electric%' OR p_name ILIKE '%plumb%'
      OR p_name ILIKE '%m&e%'                                                            THEN 'Services'
    WHEN p_name ILIKE '%wall%' OR p_name ILIKE '%window%' OR p_name ILIKE '%door%'
      OR p_name ILIKE '%block%' OR p_name ILIKE '%lintel%' OR p_name ILIKE '%dpc%'       THEN 'Walls & openings'
    WHEN p_name ILIKE '%frame%' OR p_name ILIKE '%floor%' OR p_name ILIKE '%stair%'
      OR p_name ILIKE '%column%' OR p_name ILIKE '%slab%' OR p_name ILIKE '%beam%'       THEN 'Structure'
    ELSE 'Structure'
  END;
$$;

-- Default the milestone on every stage already imported, and on future inserts.
UPDATE type_stages SET milestone = fn__default_milestone(name) WHERE milestone IS NULL;

CREATE OR REPLACE FUNCTION fn__stage_milestone_default() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.milestone IS NULL THEN NEW.milestone := fn__default_milestone(NEW.name); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_stage_milestone_default ON type_stages;
CREATE TRIGGER trg_stage_milestone_default BEFORE INSERT ON type_stages
  FOR EACH ROW EXECUTE FUNCTION fn__stage_milestone_default();

-- Set/clear a stage's milestone (recipe editing; manager-gated, Rule 1).
CREATE OR REPLACE FUNCTION fn_set_type_stage_milestone(p_stage uuid, p_milestone text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT bt.org_id INTO v_org
    FROM type_stages ts JOIN building_types bt ON bt.id = ts.building_type_id
   WHERE ts.id = p_stage;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown stage %', p_stage; END IF;
  PERFORM fn_require_org_manager(v_org);
  UPDATE type_stages SET milestone = NULLIF(btrim(p_milestone), '') WHERE id = p_stage;
END $$;
REVOKE EXECUTE ON FUNCTION fn_set_type_stage_milestone(uuid, text) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_type_stage_milestone(uuid, text) TO authenticated;

-- Per-building milestone progress, derived from stage completion. Ordered by the
-- earliest stage sequence in each milestone. status: done / in_progress / not_started.
CREATE OR REPLACE VIEW building_milestones WITH (security_invoker = true) AS
SELECT b.id AS building_id, b.org_id, b.project_id,
       COALESCE(ts.milestone, 'Other') AS milestone,
       MIN(ts.sequence) AS milestone_order,
       count(*) AS stages_total,
       count(*) FILTER (WHERE bsp.status = 'done') AS stages_done,
       CASE
         WHEN count(*) FILTER (WHERE bsp.status = 'done') = count(*) THEN 'done'
         WHEN count(*) FILTER (WHERE bsp.status IN ('done','in_progress')) > 0 THEN 'in_progress'
         ELSE 'not_started'
       END AS status
FROM buildings b
JOIN type_stages ts ON ts.building_type_id = b.building_type_id
LEFT JOIN building_stage_progress bsp ON bsp.building_id = b.id AND bsp.stage_id = ts.id
WHERE b.archived_at IS NULL
GROUP BY b.id, b.org_id, b.project_id, COALESCE(ts.milestone, 'Other');
GRANT SELECT ON building_milestones TO authenticated;
