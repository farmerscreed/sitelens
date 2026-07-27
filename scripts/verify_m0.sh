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
# `supabase status -o env` prints KEY="value" (or KEY=value); strip optional quotes.
STATUS_ENV="$(supabase status -o env)"
getenv() { printf '%s\n' "$STATUS_ENV" | sed -n "s/^$1=//p" | sed -e 's/^\"//' -e 's/\"$//'; }
DB_URL="$(getenv DB_URL)"
API_URL="$(getenv API_URL)"
ANON_KEY="$(getenv ANON_KEY)"
JWT_SECRET="$(getenv JWT_SECRET)"
: "${DB_URL:?could not read DB_URL from supabase status}"
: "${ANON_KEY:?could not read ANON_KEY from supabase status}"
: "${JWT_SECRET:?could not read JWT_SECRET from supabase status}"

# psql wrapper: use a local psql if present, else exec into the db container.
DBC="$(docker ps --filter 'name=supabase_db' --format '{{.Names}}' | head -1 || true)"
run_sql()      { if command -v psql >/dev/null 2>&1; then psql "$DB_URL" "$@"; else docker exec -i "$DBC" psql -U postgres -d postgres "$@"; fi; }
run_sql_file() { local f="$1"; if command -v psql >/dev/null 2>&1; then psql -v ON_ERROR_STOP=1 "$DB_URL" -f "$f"; else docker exec -i "$DBC" psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"; fi; }

echo "═══ 3/5 · required extensions enabled ═══"
run_sql -tA -c \
  "SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','postgis','vector','pg_cron') ORDER BY 1;"

echo "═══ 4/5 · AC-6 direct-DB isolation test ═══"
run_sql_file supabase/tests/rls_isolation.sql

echo "═══ 5/5 · AC-6 API isolation test ═══"
API_URL="$API_URL" ANON_KEY="$ANON_KEY" JWT_SECRET="$JWT_SECRET" node tests/rls_api_test.mjs

echo "═══ M0 verification complete — AC-6 satisfied by both routes ═══"
