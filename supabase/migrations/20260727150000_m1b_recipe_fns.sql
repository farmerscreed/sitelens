-- M1 · B — Recipe library write path (Rule 1). building_types / type_stages /
-- type_boq_items / type_stage_costs / type_folders have NO client write policy
-- (M0); every write goes through the SECURITY DEFINER functions below.
-- Manager = active admin OR pm of the org.

-- Upsert keys so "set" functions are idempotent.
CREATE UNIQUE INDEX uq_type_boq_item   ON type_boq_items  (building_type_id, stage_id, material_id);
CREATE UNIQUE INDEX uq_type_stage_cost ON type_stage_costs (building_type_id, stage_id, category);

-- ── authz helper: caller must be an active admin/pm of the org ───────────────
CREATE OR REPLACE FUNCTION fn_require_org_manager(p_org uuid)
RETURNS uuid  -- returns the caller's membership id
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v uuid;
BEGIN
  SELECT id INTO v FROM memberships
   WHERE user_id = auth.uid() AND org_id = p_org AND role IN ('admin','pm') AND is_active;
  IF v IS NULL THEN
    RAISE EXCEPTION 'requires an active admin/pm of org %', p_org USING errcode = '42501';
  END IF;
  RETURN v;
END $$;
REVOKE EXECUTE ON FUNCTION fn_require_org_manager(uuid) FROM anon, public;

-- ── folders ─────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_upsert_type_folder(p_org uuid, p_name text, p_parent uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM fn_require_org_manager(p_org);
  INSERT INTO type_folders (org_id, parent_id, name) VALUES (p_org, p_parent, p_name)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_upsert_type_folder(uuid, text, uuid) TO authenticated;

-- ── building types ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_create_building_type(
  p_org uuid, p_name text, p_category text DEFAULT NULL,
  p_description text DEFAULT NULL, p_folder uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_mem uuid; v_id uuid;
BEGIN
  v_mem := fn_require_org_manager(p_org);
  INSERT INTO building_types (org_id, folder_id, name, category, description, created_by)
  VALUES (p_org, p_folder, p_name, p_category, p_description, v_mem)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (p_org, auth.uid(), 'create_building_type', 'building_types', v_id,
          jsonb_build_object('name', p_name, 'category', p_category));
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_create_building_type(uuid, text, text, text, uuid) TO authenticated;

-- helper: resolve a type's org and require the caller manages it
CREATE OR REPLACE FUNCTION fn__type_org(p_type uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM building_types WHERE id = p_type;
$$;
REVOKE EXECUTE ON FUNCTION fn__type_org(uuid) FROM anon, public;

CREATE OR REPLACE FUNCTION fn_add_type_stage(
  p_type uuid, p_name text, p_sequence int, p_expected_days int DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  v_org := fn__type_org(p_type);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  PERFORM fn_require_org_manager(v_org);
  INSERT INTO type_stages (building_type_id, name, sequence, expected_days)
  VALUES (p_type, p_name, p_sequence, p_expected_days)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_add_type_stage(uuid, text, int, int) TO authenticated;

-- Set (upsert) a recipe material quantity. NO price here (Rule 4).
CREATE OR REPLACE FUNCTION fn_set_type_boq_item(
  p_type uuid, p_stage uuid, p_material uuid, p_quantity numeric, p_unit text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  v_org := fn__type_org(p_type);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  PERFORM fn_require_org_manager(v_org);
  IF NOT EXISTS (SELECT 1 FROM materials_catalog WHERE id = p_material AND org_id = v_org) THEN
    RAISE EXCEPTION 'material % is not in the type''s org', p_material USING errcode = '42501';
  END IF;
  IF p_stage IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM type_stages WHERE id = p_stage AND building_type_id = p_type) THEN
    RAISE EXCEPTION 'stage % does not belong to type %', p_stage, p_type;
  END IF;
  INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit)
  VALUES (p_type, p_stage, p_material, p_quantity, p_unit)
  ON CONFLICT (building_type_id, stage_id, material_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_set_type_boq_item(uuid, uuid, uuid, numeric, text) TO authenticated;

CREATE OR REPLACE FUNCTION fn_set_type_stage_cost(
  p_type uuid, p_stage uuid, p_category text, p_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_id uuid;
BEGIN
  v_org := fn__type_org(p_type);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  PERFORM fn_require_org_manager(v_org);
  INSERT INTO type_stage_costs (building_type_id, stage_id, category, amount)
  VALUES (p_type, p_stage, p_category, p_amount)
  ON CONFLICT (building_type_id, stage_id, category)
    DO UPDATE SET amount = EXCLUDED.amount
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
GRANT EXECUTE ON FUNCTION fn_set_type_stage_cost(uuid, uuid, text, numeric) TO authenticated;

-- ── clone helper: copy stages + boq items + stage costs, remapping stage ids ─
CREATE OR REPLACE FUNCTION fn__clone_type_children(p_old uuid, p_new uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s RECORD;
  stage_map jsonb := '{}'::jsonb;
  new_stage uuid;
BEGIN
  FOR s IN SELECT * FROM type_stages WHERE building_type_id = p_old LOOP
    new_stage := gen_random_uuid();
    INSERT INTO type_stages (id, building_type_id, name, sequence, expected_days)
    VALUES (new_stage, p_new, s.name, s.sequence, s.expected_days);
    stage_map := jsonb_set(stage_map, ARRAY[s.id::text], to_jsonb(new_stage));
  END LOOP;

  INSERT INTO type_boq_items (building_type_id, stage_id, material_id, quantity, unit, notes)
  SELECT p_new,
         CASE WHEN bi.stage_id IS NULL THEN NULL ELSE (stage_map->>bi.stage_id::text)::uuid END,
         bi.material_id, bi.quantity, bi.unit, bi.notes
  FROM type_boq_items bi WHERE bi.building_type_id = p_old;

  INSERT INTO type_stage_costs (building_type_id, stage_id, category, amount, notes)
  SELECT p_new,
         CASE WHEN sc.stage_id IS NULL THEN NULL ELSE (stage_map->>sc.stage_id::text)::uuid END,
         sc.category, sc.amount, sc.notes
  FROM type_stage_costs sc WHERE sc.building_type_id = p_old;
END $$;
REVOKE EXECUTE ON FUNCTION fn__clone_type_children(uuid, uuid) FROM anon, public;

-- Duplicate-and-tweak (F-TYPE-3): an independent copy under a new name.
CREATE OR REPLACE FUNCTION fn_duplicate_type(p_type uuid, p_new_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_new uuid; v_mem uuid;
BEGIN
  v_org := fn__type_org(p_type);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  v_mem := fn_require_org_manager(v_org);
  INSERT INTO building_types (org_id, folder_id, name, category, description, created_by)
  SELECT org_id, folder_id, p_new_name, category, description, v_mem
  FROM building_types WHERE id = p_type
  RETURNING id INTO v_new;
  PERFORM fn__clone_type_children(p_type, v_new);
  RETURN v_new;
END $$;
GRANT EXECUTE ON FUNCTION fn_duplicate_type(uuid, text) TO authenticated;

-- New version (F-TYPE-4): editing a type that already has buildings should create a
-- new version so existing buildings keep their stamped requirements. Buildings arrive
-- in M2; here we implement the version mechanic (clone + parent_version_id + version+1).
CREATE OR REPLACE FUNCTION fn_new_type_version(p_type uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_new uuid; v_mem uuid; v_ver int;
BEGIN
  v_org := fn__type_org(p_type);
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown building type %', p_type; END IF;
  v_mem := fn_require_org_manager(v_org);
  SELECT version INTO v_ver FROM building_types WHERE id = p_type;
  INSERT INTO building_types (org_id, folder_id, name, category, description, version, parent_version_id, created_by)
  SELECT org_id, folder_id, name, category, description, COALESCE(v_ver,1) + 1, p_type, v_mem
  FROM building_types WHERE id = p_type
  RETURNING id INTO v_new;
  PERFORM fn__clone_type_children(p_type, v_new);
  INSERT INTO audit_log (org_id, actor_id, action, entity_type, entity_id, after)
  VALUES (v_org, auth.uid(), 'new_type_version', 'building_types', v_new,
          jsonb_build_object('parent', p_type, 'version', COALESCE(v_ver,1) + 1));
  RETURN v_new;
END $$;
GRANT EXECUTE ON FUNCTION fn_new_type_version(uuid) TO authenticated;
