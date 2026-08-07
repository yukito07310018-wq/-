#!/usr/bin/env bash
#
# Exercises scripts/migrateProduction.sh against a throwaway PostgreSQL cluster,
# covering the states a production database can actually be in when the script
# runs. Nothing here touches a real database.
#
#   bash scripts/testMigrateProduction.sh
#
# Needs the PostgreSQL server binaries (initdb/pg_ctl) and a writable TMPDIR.
set -euo pipefail

cd "$(dirname "$0")/.."
REPO="$PWD"

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)"
if [ -z "$PGBIN" ] || [ ! -x "$PGBIN/initdb" ]; then
  echo "PostgreSQL server binaries not found; skipping." >&2
  exit 0
fi

if [ ! -x node_modules/.bin/prisma ]; then
  echo "Prisma is not installed; run npm install first." >&2
  exit 1
fi

# Take a port nothing is listening on, so a PostgreSQL already running on the
# usual one does not silently become the database under test.
PORT=""
for candidate in $(seq 5440 5470); do
  if ! (exec 3<>/dev/tcp/127.0.0.1/"$candidate") 2>/dev/null; then
    PORT="$candidate"
    break
  fi
done
if [ -z "$PORT" ]; then
  echo "No free port in 5440-5470 for the test cluster." >&2
  exit 1
fi

WORK="$(mktemp -d)"
# initdb refuses to run as root, so hand the cluster to the postgres account
# when this is running as root and fall back to the current user otherwise.
if [ "$(id -u)" -eq 0 ]; then
  PGDATA="/var/lib/postgresql/migrate-test-$$"
  RUNAS="su postgres -c"
else
  PGDATA="$WORK/pgdata"
  RUNAS="bash -c"
fi

cleanup() {
  $RUNAS "$PGBIN/pg_ctl -D $PGDATA stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  [ "$(id -u)" -eq 0 ] && rm -rf "$PGDATA"
  return 0
}
trap cleanup EXIT

$RUNAS "$PGBIN/initdb -D $PGDATA -A trust -U postgres" >/dev/null 2>&1
$RUNAS "$PGBIN/pg_ctl -D $PGDATA -o '-p $PORT -k /tmp' -l $PGDATA/log start" >/dev/null 2>&1
for _ in $(seq 1 20); do
  psql -h 127.0.0.1 -p "$PORT" -U postgres -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 0.5
done

failures=0
url_for() { printf 'postgresql://postgres@127.0.0.1:%s/%s' "$PORT" "$1"; }
fresh_db() {
  psql -h 127.0.0.1 -p "$PORT" -U postgres -c "DROP DATABASE IF EXISTS $1" >/dev/null 2>&1
  psql -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE DATABASE $1" >/dev/null 2>&1
}
# Each case runs the script from a copy of the project, so a case that adds a
# migration to exercise the destructive gate cannot leave it in the repository.
sandbox() {
  rm -rf "$WORK/proj"
  mkdir -p "$WORK/proj"
  cp -r "$REPO/prisma" "$REPO/scripts" "$REPO/prisma.config.ts" "$REPO/package.json" "$WORK/proj/"
  ln -s "$REPO/node_modules" "$WORK/proj/node_modules"
}
check() {
  local label="$1" expected="$2" output="$3"
  if printf '%s' "$output" | grep -qF "$expected"; then
    echo "  ok    $label"
  else
    echo "  FAIL  $label — expected to find: $expected"
    failures=$((failures + 1))
  fi
}

run_script() {
  ( cd "$WORK/proj" && env "$@" bash scripts/migrateProduction.sh 2>&1 ) || true
}

echo "== empty database applies the migration normally"
sandbox; fresh_db empty_db
out="$(run_script "DATABASE_URL=$(url_for empty_db)")"
check "migration applied" "All migrations have been successfully applied." "$out"

echo "== schema created by db push is baselined, not replayed"
sandbox; fresh_db pushed_db
( cd "$WORK/proj" && DATABASE_URL="$(url_for pushed_db)" npx prisma db push ) >/dev/null 2>&1
out="$(run_script "DATABASE_URL=$(url_for pushed_db)")"
check "P3005 detected" "Database already has tables" "$out"
check "no drift reported" "No drift" "$out"
check "history baselined" "Database schema is up to date!" "$out"
steps="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d pushed_db -tAc \
  'select applied_steps_count from _prisma_migrations' 2>/dev/null | tr -d ' ')"
check "baseline ran no SQL" "0" "$steps"

echo "== a schema that drifted from the datamodel stops the run"
sandbox; fresh_db drift_db
( cd "$WORK/proj" && DATABASE_URL="$(url_for drift_db)" npx prisma db push ) >/dev/null 2>&1
psql -h 127.0.0.1 -p "$PORT" -U postgres -d drift_db \
  -c 'ALTER TABLE "Session" DROP COLUMN "processing"' >/dev/null 2>&1
out="$(run_script "DATABASE_URL=$(url_for drift_db)")"
check "drift reported" "deployed schema differs" "$out"
check "outstanding SQL shown" 'ADD COLUMN     "processing"' "$out"
check "nothing changed" "Nothing was changed." "$out"

echo "== a migration that drops data is refused, then allowed on override"
sandbox; fresh_db destructive_db
# Bring the tables into existence first, so refusing the drop is observable as
# the table still being there rather than as it having never been created.
run_script "DATABASE_URL=$(url_for destructive_db)" >/dev/null
mkdir -p "$WORK/proj/prisma/migrations/20260901000000_drop_evidence"
printf 'DROP TABLE "Evidence";\n' \
  > "$WORK/proj/prisma/migrations/20260901000000_drop_evidence/migration.sql"
out="$(run_script "DATABASE_URL=$(url_for destructive_db)")"
check "destructive migration blocked" "can destroy existing data" "$out"
survived="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d destructive_db -tAc \
  "select count(*) from pg_tables where tablename='Evidence'" 2>/dev/null | tr -d ' ')"
check "table survived the refusal" "1" "$survived"
out="$(run_script "DATABASE_URL=$(url_for destructive_db)" "CONFIRM_DESTRUCTIVE=1")"
check "override applies it" "Database schema is up to date!" "$out"
dropped="$(psql -h 127.0.0.1 -p "$PORT" -U postgres -d destructive_db -tAc \
  "select count(*) from pg_tables where tablename='Evidence'" 2>/dev/null | tr -d ' ')"
check "table dropped under override" "0" "$dropped"

echo "== an unreachable database applies nothing"
sandbox
out="$(run_script "DATABASE_URL=postgresql://postgres@127.0.0.1:5499/nope")"
check "connection failure reported" "Could not connect to the database" "$out"

echo "== a connection string that is not a URL is rejected"
sandbox
out="$(run_script "DATABASE_URL=[SENSITIVE]")"
check "placeholder rejected" "is not a postgres:// or prisma+postgres:// URL" "$out"

echo "== the printed target never shows the password"
sandbox
# The @ inside the password is the interesting part: masking only as far as the
# first one leaves the rest of it on screen.
out="$(run_script "DATABASE_URL=postgres://someone:pa@ss@127.0.0.1:5499/nope")"
check "password blanked" "someone:****@127.0.0.1:5499" "$out"
if printf '%s' "$out" | grep -qF 'pa@ss'; then
  echo "  FAIL  password absent from output — found it in the printed target"
  failures=$((failures + 1))
else
  echo "  ok    password absent from output"
fi

echo
if [ "$failures" -eq 0 ]; then
  echo "All checks passed."
else
  echo "$failures check(s) failed." >&2
  exit 1
fi
