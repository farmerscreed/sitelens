-- Stage durations → realistic cash-flow timeline (founder pilot Area 5, 2026-08-02).
--
-- type_stages.expected_days already exists and the planner already spaced stages by it;
-- what was missing: (1) a way to SET a duration on an existing recipe stage, and (2) the
-- feasibility placed each stage's whole cost as a lump at its start period. Now a stage's
-- cost is SPREAD LINEARLY across the periods it spans, so the curve reflects real build
-- time. A stage that spans one period is unchanged (lump = spread), so AC-8 is untouched.

-- ── set/clear a recipe stage's duration (days) ──────────────────────────────
CREATE OR REPLACE FUNCTION fn_set_type_stage_days(p_stage uuid, p_expected_days int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid;
BEGIN
  SELECT bt.org_id INTO v_org
    FROM type_stages ts JOIN building_types bt ON bt.id = ts.building_type_id
   WHERE ts.id = p_stage;
  IF v_org IS NULL THEN RAISE EXCEPTION 'unknown stage %', p_stage; END IF;
  PERFORM fn_require_org_manager(v_org);
  IF p_expected_days IS NOT NULL AND p_expected_days < 0 THEN
    RAISE EXCEPTION 'duration must be >= 0 days';
  END IF;
  UPDATE type_stages SET expected_days = p_expected_days WHERE id = p_stage;
END $$;
REVOKE EXECUTE ON FUNCTION fn_set_type_stage_days(uuid, int) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_set_type_stage_days(uuid, int) TO authenticated;

-- ── feasibility: spread each stage's cost across its duration ────────────────
CREATE OR REPLACE FUNCTION fn_compute_feasibility(p_plan uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid; v_assump jsonb; v_inflows jsonb; v_unit text; v_pdays int; v_defper int;
  line RECORD; st RECORD; inf RECORD;
  v_start int; v_cursor int; v_dur int; v_cost numeric; v_tgt_seq int;
  d int; idx int; per numeric;
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
      SELECT COALESCE(cost, 0) INTO v_cost FROM type_stage_cost
       WHERE building_type_id = line.building_type_id AND stage_id = st.id;
      v_cost := COALESCE(v_cost, 0) * line.quantity;

      -- how many periods this stage spans, then spread its cost evenly across them.
      v_dur := GREATEST(COALESCE(CEIL(st.expected_days::numeric / v_pdays)::int, v_defper), 1);
      per := v_cost / v_dur;
      FOR d IN 0 .. v_dur - 1 LOOP
        idx := v_cursor + d;
        IF outflow[idx+1] IS NULL THEN outflow[idx+1] := 0; END IF;
        outflow[idx+1] := outflow[idx+1] + per;
        IF idx > v_maxp THEN v_maxp := idx; END IF;
      END LOOP;
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
    'period_unit', v_unit, 'periods', periods, 'total_funding', v_total,
    'peak_period_requirement', v_peak_period, 'peak_funding', v_peak_funding);
END $$;
REVOKE EXECUTE ON FUNCTION fn_compute_feasibility(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_compute_feasibility(uuid) TO authenticated;
