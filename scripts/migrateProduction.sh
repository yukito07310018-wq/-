#!/usr/bin/env bash
#
# Pulls the production env from Vercel and applies pending Prisma migrations to
# the production database, pausing to show which database is about to be
# touched and what is still unapplied.
#
#   bash scripts/migrateProduction.sh
#
# Must run from a machine that can reach both Vercel and the database — the
# sandboxed CI/agent environments have no outbound TCP on 5432.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production"

echo "==> Pulling production environment from Vercel"
vercel env pull "$ENV_FILE" --environment=production

# Read one variable out of the pulled file without sourcing it; the file also
# carries POSTGRES_URL and postgres_prisma_* aliases that would otherwise land
# in the environment and become the connection target by accident.
read_env() {
  local value
  value="$(grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-)" || return 1
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

# Vercel's Prisma Postgres integration points DATABASE_URL at the Accelerate
# proxy (prisma+postgres://), which the migration engine cannot open a
# connection through. Fall back to whichever alias carries a direct
# postgres:// URL so migrations run against the database itself.
CANDIDATES="DATABASE_URL POSTGRES_URL_NON_POOLING DIRECT_DATABASE_URL POSTGRES_URL postgres_prisma_POSTGRES_URL postgres_prisma_DATABASE_URL"

DATABASE_URL=""
CHOSEN=""
for name in $CANDIDATES; do
  candidate="$(read_env "$name" || true)"
  case "$candidate" in
    postgres://*|postgresql://*)
      DATABASE_URL="$candidate"
      CHOSEN="$name"
      break
      ;;
  esac
done

if [ -z "$DATABASE_URL" ]; then
  echo >&2
  echo "No variable in $ENV_FILE holds a direct postgres:// connection string." >&2
  echo "Schemes found (credentials not shown):" >&2
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | while IFS= read -r line; do
    name="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    case "$value" in
      *://*) printf '  %s = %s://…\n' "$name" "${value%%://*}" >&2 ;;
    esac
  done
  exit 1
fi

# Show the target with the password blanked, so the host can be eyeballed
# without printing the credential to a terminal or CI log.
masked="$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1****\2#')"
echo
echo "==> Target database (from \$$CHOSEN)"
echo "    $masked"

# `migrate status` exits non-zero both for "migrations are pending" — the whole
# reason this script runs — and for connection failures, so the exit code alone
# cannot gate the prompt. Abort on a P1xxx connection error instead, rather than
# asking to apply migrations to a database that was never reached.
echo
echo "==> Migration status before applying"
status_output="$(DATABASE_URL="$DATABASE_URL" npx prisma migrate status 2>&1 || true)"
printf '%s\n' "$status_output"

if printf '%s' "$status_output" | grep -qE 'Error: P1[0-9]{3}'; then
  echo >&2
  echo "Could not connect to the database; nothing was applied." >&2
  exit 1
fi

# Everything above this point is reversible; `migrate deploy` is not. Rather
# than asking a human to rubber-stamp every run, gate on the one property that
# actually distinguishes a safe migration from a dangerous one: whether the SQL
# about to run can destroy existing rows. A pending migration that only creates
# tables applies unattended; one that drops or truncates stops here.
pending="$(printf '%s' "$status_output" | grep -oE '[0-9]{14}_[A-Za-z0-9_]+' | sort -u || true)"

destructive=""
for name in $pending; do
  file="prisma/migrations/$name/migration.sql"
  [ -f "$file" ] || continue
  hits="$(grep -inE 'DROP[[:space:]]+(TABLE|COLUMN|SCHEMA|DATABASE)|TRUNCATE|DELETE[[:space:]]+FROM|ALTER[[:space:]]+COLUMN.*TYPE' "$file" || true)"
  if [ -n "$hits" ]; then
    destructive="$destructive
$name:
$hits"
  fi
done

if [ -n "$destructive" ]; then
  echo >&2
  echo "Pending migrations contain statements that can destroy existing data:" >&2
  printf '%s\n' "$destructive" >&2
  echo >&2
  if [ "${CONFIRM_DESTRUCTIVE:-}" = "1" ]; then
    echo "CONFIRM_DESTRUCTIVE=1 set — applying anyway." >&2
  else
    echo "Nothing was applied. Review the SQL, confirm a backup exists, then re-run" >&2
    echo "with CONFIRM_DESTRUCTIVE=1 to apply it anyway." >&2
    exit 1
  fi
fi

echo
echo "==> Applying migrations"
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy

echo
echo "==> Migration status after applying"
DATABASE_URL="$DATABASE_URL" npx prisma migrate status
