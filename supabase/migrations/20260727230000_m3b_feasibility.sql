-- M3 · B — The cash-flow engine (§7, F-PLAN-2/3/5, §16.4). Read-only, gated on
-- membership of the plan's org. Results are ALWAYS computed live from current prices
-- so a price change updates every saved scenario (F-PLAN-6 / AC-7). Quantity is a
-- multiplier (not a per-building loop) → O(lines × stages), fast for 300 (NF-13).

-- ── funding-required: period-by-period cash requirement + peak + total ──────
CREATE OR REPLACE FUNCTION fn_compute_feasibility(p_plan uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_assump jsonb; v_inflows jsonb; v_unit text; v_pdays int; v_defper int;
  line RECORD; st RECORD; inf RECORD;
  v_start int; v_cursor int; v_dur int; v_cost numeric; v_tgt_seq int;
  outflow numeric[] := ARRAY[]::numeric[];
  inflow  numeric[] := ARRAY[]::numeric[];
  v_maxp int := 0; p int; o numeric; i numeric;
  cum numeric := 0; cin numeric := 0; net numeric;
  v_total numeric := 0; v_peak_period numeric := 0; v_peak_funding numeric := 0;
  periods jsonb := '[]'::jsonb;
BEGIN
  SELECT org_id, COALESCE(assumptions,'{}'::jsonb), COALESCE(inflows,'[]'::jsonb)
    INTO v_org, v_assump, v_inflows FROM plans WHERE id = p_plan;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND org_id = v_org AND is_active) THEN
    RAISE EXCEPTION 'not a member of the plan''s org' USING errcode = '42501';
  END IF;

  v_unit   := COALESCE(v_assump->>'period_unit', 'week');
  v_pdays  := COALESCE((v_assump->>'period_days')::int, CASE WHEN v_unit = 'month' THEN 30 ELSE 7 END);
  v_defper := GREATEST(COALESCE((v_assump->>'default_stage_periods')::int, 1), 1);

  FOR line IN SELECT * FROM plan_lines WHERE plan_id = p_plan LOOP
    v_start := COALESCE((v_assump->'batches'->(line.batch_hint)->>'start')::int, 0);
    IF line.target_stage_id IS NULL THEN v_tgt_seq := 2147483647;
    ELSE SELECT sequence INTO v_tgt_seq FROM type_stages WHERE id = line.target_stage_id; END IF;

    v_cursor := v_start;
    FOR st IN SELECT ts.id, ts.sequence, ts.expected_days FROM type_stages ts
              WHERE ts.building_type_id = line.building_type_id AND ts.sequence <= v_tgt_seq
              ORDER BY ts.sequence LOOP
      SELECT COALESCE(SUM(bi.quantity * COALESCE(current_price(v_org, bi.material_id), 0)), 0)
        INTO v_cost FROM type_boq_items bi
       WHERE bi.building_type_id = line.building_type_id AND bi.stage_id = st.id;
      v_cost := v_cost + COALESCE(
        (SELECT SUM(amount) FROM type_stage_costs WHERE building_type_id = line.building_type_id AND stage_id = st.id), 0);
      v_cost := v_cost * line.quantity;

      IF outflow[v_cursor+1] IS NULL THEN outflow[v_cursor+1] := 0; END IF;
      outflow[v_cursor+1] := outflow[v_cursor+1] + v_cost;
      IF v_cursor > v_maxp THEN v_maxp := v_cursor; END IF;

      v_dur := GREATEST(COALESCE(CEIL(st.expected_days::numeric / v_pdays)::int, v_defper), 1);
      v_cursor := v_cursor + v_dur;
    END LOOP;
  END LOOP;

  FOR inf IN SELECT value AS v FROM jsonb_array_elements(v_inflows) LOOP
    p := COALESCE((inf.v->>'period')::int, 0);
    IF inflow[p+1] IS NULL THEN inflow[p+1] := 0; END IF;
    inflow[p+1] := inflow[p+1] + COALESCE((inf.v->>'amount')::numeric, 0);
    IF p > v_maxp THEN v_maxp := p; END IF;
  END LOOP;

  FOR p IN 0 .. v_maxp LOOP
    o := COALESCE(outflow[p+1], 0);
    i := COALESCE(inflow[p+1], 0);
    cum := cum + o; cin := cin + i; net := cum - cin;
    v_total := v_total + o;
    IF o   > v_peak_period  THEN v_peak_period  := o;   END IF;
    IF net > v_peak_funding THEN v_peak_funding := net; END IF;
    periods := periods || jsonb_build_object(
      'period', p, 'outflow', o, 'cumulative', cum, 'inflow', i, 'net_cumulative', net);
  END LOOP;

  RETURN jsonb_build_object(
    'period_unit', v_unit,
    'periods', periods,
    'total_funding', v_total,
    'peak_period_requirement', v_peak_period,  -- max single-period need (drops when staggered, F-PLAN-4)
    'peak_funding', v_peak_funding             -- max cumulative capital, net of inflows
  );
END $$;
REVOKE EXECUTE ON FUNCTION fn_compute_feasibility(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_compute_feasibility(uuid) TO authenticated;

-- ── max-delivery: how many units of the plan's mix fit the cash (F-PLAN-5) ──
CREATE OR REPLACE FUNCTION fn_max_delivery(p_plan uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_avail numeric; v_inflows jsonb; v_total_avail numeric;
  line RECORD; v_tgt_seq int; v_unit_cost numeric; v_mix_cost numeric := 0; k int;
  per_type jsonb := '[]'::jsonb;
BEGIN
  SELECT org_id, COALESCE(available_cash, 0), COALESCE(inflows, '[]'::jsonb)
    INTO v_org, v_avail, v_inflows FROM plans WHERE id = p_plan;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown plan %', p_plan; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = auth.uid() AND org_id = v_org AND is_active) THEN
    RAISE EXCEPTION 'not a member of the plan''s org' USING errcode = '42501';
  END IF;

  SELECT v_avail + COALESCE(SUM((value->>'amount')::numeric), 0)
    INTO v_total_avail FROM jsonb_array_elements(v_inflows);

  -- cost of one "mix" = Σ (line.quantity × cost-per-unit to that line's target stage)
  FOR line IN SELECT * FROM plan_lines WHERE plan_id = p_plan LOOP
    IF line.target_stage_id IS NULL THEN v_tgt_seq := 2147483647;
    ELSE SELECT sequence INTO v_tgt_seq FROM type_stages WHERE id = line.target_stage_id; END IF;
    SELECT COALESCE(SUM(
      (SELECT COALESCE(SUM(bi.quantity * COALESCE(current_price(v_org, bi.material_id), 0)), 0)
         FROM type_boq_items bi WHERE bi.building_type_id = line.building_type_id AND bi.stage_id = ts.id)
      + COALESCE((SELECT SUM(amount) FROM type_stage_costs
                   WHERE building_type_id = line.building_type_id AND stage_id = ts.id), 0)
    ), 0) INTO v_unit_cost
    FROM type_stages ts WHERE ts.building_type_id = line.building_type_id AND ts.sequence <= v_tgt_seq;

    v_mix_cost := v_mix_cost + v_unit_cost * line.quantity;
    per_type := per_type || jsonb_build_object(
      'building_type_id', line.building_type_id, 'per_mix_quantity', line.quantity, 'unit_cost', v_unit_cost);
  END LOOP;

  k := CASE WHEN v_mix_cost <= 0 THEN 0 ELSE floor(v_total_avail / v_mix_cost)::int END;

  RETURN jsonb_build_object(
    'available', v_total_avail,
    'mix_cost', v_mix_cost,
    'multiplier', k,                       -- how many full "mixes" the cash buys
    'total_cost', v_mix_cost * k,
    'per_type', per_type                   -- deliverable = per_mix_quantity × multiplier
  );
END $$;
REVOKE EXECUTE ON FUNCTION fn_max_delivery(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_max_delivery(uuid) TO authenticated;
