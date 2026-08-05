#!/usr/bin/env bash
# Rebuild the whole schema from migrations + seed and run every test suite, against
# the running supabase_db_sitelens container via docker exec. This is the verifier
# that works on THIS box (where the Docker daemon blocks container recreation, so
# `supabase db reset` can't run). On a normal machine, `supabase db reset` +
# scripts/verify_m0.sh do the same for M0; the tests below extend to M1.
set -euo pipefail
cd "$(dirname "$0")/.."
C="${DB_CONTAINER:-supabase_db_sitelens}"
PSQL="docker exec -i $C psql -U postgres -d postgres -v ON_ERROR_STOP=1"

echo "═══ clean rebuild (all migrations + seed) ═══"
$PSQL -q <<'SQL'
DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO postgres, service_role;
SQL
for f in supabase/migrations/*.sql; do $PSQL -q < "$f" >/dev/null; done
$PSQL -q < supabase/seed.sql >/dev/null
echo "→ $(ls supabase/migrations/*.sql | wc -l) migrations + seed applied"

echo "═══ tests ═══"
fail=0
for t in rls_isolation a0_token_hook ac7_price_recost b_recipe type_cover ac5_boq_import boq_v2_staging boq_bootstrap boq_workbook delete_paths truecost workitem_est workdone_ev building_money scope archive material_plan milestones field_ops g_hardening m2_buildings_board ac8_feasibility planner_truecost ac1_offline_sync ac4_material_balance ac9_overrun ac11_expense_approval expense_building payments clients member_invite media_building ac3_duplicate_photo m6_reorder_advice m6_inference ac13_portal m7_notify; do
  printf "  %-20s " "$t"
  if out=$($PSQL < "supabase/tests/$t.sql" 2>&1); then
    echo "$out" | grep -oE "(PASS[^.]*|ALL PASS)" | head -1
  else
    echo "FAILED"; echo "$out" | tail -5; fail=1
  fi
done
printf "  %-20s " "boq_core (node)"
if out=$(node tests/boq_core_test.mjs 2>&1); then echo "$out" | grep -oE "ALL PASS" | head -1
else echo "FAILED"; echo "$out" | tail -5; fail=1; fi
printf "  %-20s " "boq_workbook (node)"
if out=$(node tests/boq_workbook_test.mjs 2>&1); then echo "$out" | grep -oE "ALL PASS" | head -1
else echo "FAILED"; echo "$out" | tail -5; fail=1; fi

[ $fail = 0 ] && echo "═══ ALL GREEN ═══" || { echo "═══ FAILURES ═══"; exit 1; }
