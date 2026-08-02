-- Planner on the true-cost engine (founder pilot, 2026-08-02).
--
-- fn_compute_feasibility / fn_max_delivery costed each stage as
--   Σ(type_boq_items.qty × current_price) + Σ type_stage_costs
-- i.e. DIRECT-supply materials only + non-material stage costs. For a recipe built
-- from work items + mixes (Terrace Type B) that is a ~5× undercount (₦60.5M vs the
-- real ₦288.8M) — labour, plant, mix-derived materials and QS-rate lines are missing,
-- so every plan number (total, peaks, funding gap, max-delivery) was far too low.
--
-- Fix: cost each stage from a unified `type_stage_cost` view = the work-item true
-- cost (work_item_cost.est_cost, in-scope, mixes + labour + QS-rate fallback) where a
-- type HAS work items, else the legacy basis (so manually-built recipes and the AC-8
-- test — which use type_boq_items + stage costs and no work items — are unchanged).
-- Unstaged work-item cost is folded into the type's first stage so nothing is dropped.

CREATE OR REPLACE VIEW type_stage_cost WITH (security_invoker = true) AS
WITH first_stage AS (                    -- lowest-sequence stage per type (home for unstaged cost)
  SELECT DISTINCT ON (building_type_id) building_type_id, id AS stage_id
  FROM type_stages ORDER BY building_type_id, sequence
),
wi_staged AS (                           -- true cost per actual stage (work items)
  SELECT wc.building_type_id, wc.stage_id, SUM(wc.est_cost) AS cost
  FROM work_item_cost wc
  WHERE wc.in_scope AND wc.est_cost IS NOT NULL AND wc.stage_id IS NOT NULL
  GROUP BY wc.building_type_id, wc.stage_id
),
wi_unstaged AS (                         -- unstaged true cost, folded into the first stage
  SELECT wc.building_type_id, SUM(wc.est_cost) AS cost
  FROM work_item_cost wc
  WHERE wc.in_scope AND wc.est_cost IS NOT NULL AND wc.stage_id IS NULL
  GROUP BY wc.building_type_id
),
type_has_wi AS (                         -- which types use the true-cost engine at all
  SELECT DISTINCT building_type_id FROM work_item_cost WHERE in_scope AND est_cost IS NOT NULL
),
legacy AS (                              -- old basis per stage: for types with NO work items
  SELECT ts.building_type_id, ts.id AS stage_id,
         COALESCE((SELECT SUM(bi.quantity * COALESCE(current_price(bt.org_id, bi.material_id), 0))
                     FROM type_boq_items bi
                    WHERE bi.building_type_id = ts.building_type_id AND bi.stage_id = ts.id), 0)
       + COALESCE((SELECT SUM(amount) FROM type_stage_costs sc
                    WHERE sc.building_type_id = ts.building_type_id AND sc.stage_id = ts.id), 0) AS cost
  FROM type_stages ts JOIN building_types bt ON bt.id = ts.building_type_id
)
SELECT ts.building_type_id, ts.id AS stage_id,
       CASE WHEN thw.building_type_id IS NOT NULL
            THEN COALESCE(ws.cost, 0)
                 + CASE WHEN fs.stage_id = ts.id THEN COALESCE(wu.cost, 0) ELSE 0 END
            ELSE COALESCE(lg.cost, 0)
       END AS cost
FROM type_stages ts
LEFT JOIN type_has_wi  thw ON thw.building_type_id = ts.building_type_id
LEFT JOIN wi_staged    ws  ON ws.building_type_id = ts.building_type_id AND ws.stage_id = ts.id
LEFT JOIN wi_unstaged  wu  ON wu.building_type_id = ts.building_type_id
LEFT JOIN first_stage  fs  ON fs.building_type_id = ts.building_type_id
LEFT JOIN legacy       lg  ON lg.building_type_id = ts.building_type_id AND lg.stage_id = ts.id;
GRANT SELECT ON type_stage_cost TO authenticated;

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
      -- true-cost per stage (work-item est_cost, else legacy basis) × the line's quantity.
      SELECT COALESCE(cost, 0) INTO v_cost FROM type_stage_cost
       WHERE building_type_id = line.building_type_id AND stage_id = st.id;
      v_cost := COALESCE(v_cost, 0) * line.quantity;

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
    'peak_period_requirement', v_peak_period,
    'peak_funding', v_peak_funding
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

  -- cost of one "mix" = Σ (line.quantity × true cost-per-unit to that line's target stage)
  FOR line IN SELECT * FROM plan_lines WHERE plan_id = p_plan LOOP
    IF line.target_stage_id IS NULL THEN v_tgt_seq := 2147483647;
    ELSE SELECT sequence INTO v_tgt_seq FROM type_stages WHERE id = line.target_stage_id; END IF;
    SELECT COALESCE(SUM(sc.cost), 0) INTO v_unit_cost
      FROM type_stage_cost sc JOIN type_stages ts ON ts.id = sc.stage_id
     WHERE sc.building_type_id = line.building_type_id AND ts.sequence <= v_tgt_seq;

    v_mix_cost := v_mix_cost + v_unit_cost * line.quantity;
    per_type := per_type || jsonb_build_object(
      'building_type_id', line.building_type_id, 'per_mix_quantity', line.quantity, 'unit_cost', v_unit_cost);
  END LOOP;

  k := CASE WHEN v_mix_cost <= 0 THEN 0 ELSE floor(v_total_avail / v_mix_cost)::int END;

  RETURN jsonb_build_object(
    'available', v_total_avail,
    'mix_cost', v_mix_cost,
    'multiplier', k,
    'total_cost', v_mix_cost * k,
    'per_type', per_type
  );
END $$;
REVOKE EXECUTE ON FUNCTION fn_max_delivery(uuid) FROM anon, public;
GRANT  EXECUTE ON FUNCTION fn_max_delivery(uuid) TO authenticated;
