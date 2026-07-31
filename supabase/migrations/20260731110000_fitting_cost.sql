-- Fittings (doors, sanitary ware, wardrobes) are priced per piece exactly like
-- supply items once linked to a catalog material — the founder's unpriced
-- fittings had NO way to receive a price before this.
CREATE OR REPLACE FUNCTION fn_work_item_unit_cost(p_work_item uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE wi type_work_items%ROWTYPE; v numeric; v_org uuid;
BEGIN
  SELECT * INTO wi FROM type_work_items WHERE id = p_work_item;
  IF wi.id IS NULL THEN RETURN NULL; END IF;
  SELECT org_id INTO v_org FROM building_types WHERE id = wi.building_type_id;

  IF wi.kind IN ('material_supply','fitting') AND wi.material_id IS NOT NULL THEN
    RETURN current_price(v_org, wi.material_id) * fn_convert_to_material_unit(wi.material_id, 1, wi.unit);
  ELSIF wi.kind = 'composite' AND wi.assembly_id IS NOT NULL THEN
    SELECT COALESCE(SUM(
             CASE WHEN ac.component_kind = 'reusable'
                  THEN ac.qty_per_unit / GREATEST(COALESCE(ac.reuse_count, 1), 1)
                  ELSE ac.qty_per_unit * ac.waste_factor END
             * current_price(v_org, ac.material_id)
             * COALESCE(fn_convert_to_material_unit(ac.material_id, 1, ac.unit), 1)), 0)
           + COALESCE(fn_current_labour_rate(v_org, a.id), a.labour_rate, 0)
           + COALESCE(a.plant_rate, 0)
      INTO v
      FROM assemblies a LEFT JOIN assembly_components ac ON ac.assembly_id = a.id
     WHERE a.id = wi.assembly_id
     GROUP BY a.id, a.labour_rate, a.plant_rate;
    RETURN v;
  ELSIF wi.kind IN ('labour','plant') AND wi.assembly_id IS NOT NULL THEN
    SELECT COALESCE(fn_current_labour_rate(v_org, a.id), a.labour_rate, 0) + COALESCE(a.plant_rate, 0)
      INTO v FROM assemblies a WHERE a.id = wi.assembly_id;
    RETURN v;
  END IF;
  RETURN NULL;
END $$;
