#!/usr/bin/env bash
# M0 verification — rebuild from migrations and prove AC-6 both ways.
# Assumes the local stack is up (`supabase start`). Run from repo root.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "═══ 1/5 · supabase db reset (rebuild from migrations + seed) ═══"
supabase db reset

echo "═══ 2/5 · supabase db reset AGAIN (reproducibility) ═══"
supabase db reset

# Pull connection + keys from the running stack.
DB_URL="$(supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')"
API_URL="$(supabase status -o env | sed -n 's/^API_URL="\(.*\)"$/\1/p')"
ANON_KEY="$(supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')"
JWT_SECRET="$(supabase status -o env | sed -n 's/^JWT_SECRET="\(.*\)"$/\1/p')"
: "${DB_URL:?could not read DB_URL from supabase status}"

echo "═══ 3/5 · required extensions enabled ═══"
psql "$DB_URL" -tA -c \
  "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','postgis','vector','pg_cron') ORDER BY 1;"

echo "═══ 4/5 · AC-6 direct-DB isolation test ═══"
psql -v ON_ERROR_STOP=1 "$DB_URL" -f supabase/tests/rls_isolation.sql

echo "═══ 5/5 · AC-6 API isolation test ═══"
API_URL="$API_URL" ANON_KEY="$ANON_KEY" JWT_SECRET="$JWT_SECRET" node tests/rls_api_test.mjs

echo "═══ M0 verification complete — AC-6 satisfied by both routes ═══"
