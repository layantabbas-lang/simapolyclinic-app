#!/usr/bin/env bash
# =============================================================
# run_migrations.sh
#
# Applies pending migrations to one clinic database, or to every
# database listed in clinics.txt (one connection string per line).
#
#   ./run_migrations.sh "postgresql://postgres:pw@db.xxx.supabase.co:5432/postgres"
#   ./run_migrations.sh --all
#
# Each migration is idempotent, so re-running is harmless. The
# app.schema_migrations table is still checked first so you can see
# at a glance what a given clinic is on.
# =============================================================
set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "$0")" && pwd)/migrations"

apply_to_db() {
  local conn="$1"
  local label="${conn##*@}"; label="${label%%:*}"

  echo "=== $label ==="

  # Bootstrap the ledger so the query below never fails on a fresh DB.
  psql "$conn" -v ON_ERROR_STOP=1 -q -c \
    "create schema if not exists app;
     create table if not exists app.schema_migrations (
       version text primary key, name text not null,
       applied_at timestamptz not null default now());" >/dev/null

  local applied
  applied="$(psql "$conn" -At -c "select version from app.schema_migrations")"

  for file in "$MIGRATIONS_DIR"/*.sql; do
    local base version
    base="$(basename "$file")"
    version="${base%%_*}"

    if grep -qx "$version" <<<"$applied"; then
      echo "  skip    $base"
      continue
    fi

    echo "  apply   $base"
    psql "$conn" -v ON_ERROR_STOP=1 -q -f "$file"
  done

  # Fail loudly if any table shipped without RLS.
  local unprotected
  unprotected="$(psql "$conn" -At -c "
    select count(*) from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity")"

  if [[ "$unprotected" != "0" ]]; then
    echo "  ERROR: $unprotected table(s) in public have RLS disabled" >&2
    exit 1
  fi

  echo "  ok"
}

if [[ "${1:-}" == "--all" ]]; then
  while IFS= read -r conn; do
    [[ -z "$conn" || "$conn" == \#* ]] && continue
    apply_to_db "$conn"
  done < "$(dirname "$0")/clinics.txt"
else
  apply_to_db "${1:?usage: run_migrations.sh <connection-string> | --all}"
fi
