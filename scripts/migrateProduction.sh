#!/usr/bin/env bash
#
# Applies pending Prisma migrations to the production database, refusing to
# apply anything that can destroy existing rows without an explicit override.
#
#   bash scripts/migrateProduction.sh
#
# The connection string normally comes from `vercel env pull`. A variable marked
# Sensitive in Vercel cannot be read back afterwards — the pull writes the
# literal text "[SENSITIVE]" in place of the value — so for those, copy the
# string from the database's own dashboard and pass it in directly:
#
#   DATABASE_URL='postgres://…' bash scripts/migrateProduction.sh
#
# Must run from a machine that can reach both Vercel and the database — the
# sandboxed CI/agent environments have no outbound TCP on 5432.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production"

# Prisma Postgres hands out prisma+postgres:// rather than a bare postgres://
# host, and the migrate engine connects through it, so treat it as usable
# instead of holding out for a direct URL that may not exist.
usable_url() {
  case "$1" in
    postgres://*|postgresql://*|prisma+postgres://*) return 0 ;;
    *) return 1 ;;
  esac
}

# Read one variable out of the pulled file without sourcing it; the file also
# carries POSTGRES_URL and postgres_prisma_* aliases that would otherwise land
# in the environment and become the connection target by accident.
read_env() {
  local value
  value="$(grep "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-)" || return 1
  value="${value%$'\r'}"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

CHOSEN=""
if [ -n "${DATABASE_URL:-}" ]; then
  # An explicitly supplied URL wins; it is the escape hatch for Sensitive
  # variables, so pulling from Vercel here would only overwrite it.
  if ! usable_url "$DATABASE_URL"; then
    echo "DATABASE_URL is set but is not a postgres:// or prisma+postgres:// URL." >&2
    exit 1
  fi
  echo "==> Using DATABASE_URL from the environment"
  CHOSEN="the environment"
else
  echo "==> Pulling production environment from Vercel"
  vercel env pull "$ENV_FILE" --environment=production

  CANDIDATES="DATABASE_URL POSTGRES_URL_NON_POOLING DIRECT_DATABASE_URL POSTGRES_URL postgres_prisma_POSTGRES_URL postgres_prisma_DATABASE_URL postgres_prisma_PRISMA_DATABASE_URL"
  DATABASE_URL=""
  for name in $CANDIDATES; do
    candidate="$(read_env "$name" || true)"
    if usable_url "$candidate"; then
      DATABASE_URL="$candidate"
      CHOSEN="$name"
      break
    fi
  done
fi

if [ -z "${DATABASE_URL:-}" ]; then
  sensitive=""
  grep -q '\[SENSITIVE\]' "$ENV_FILE" && sensitive=yes
  echo >&2
  echo "No variable in $ENV_FILE holds a usable connection string." >&2
  if [ -n "$sensitive" ]; then
    echo >&2
    echo "At least one value came back as the literal text \"[SENSITIVE]\". Those" >&2
    echo "variables are marked Sensitive in Vercel and cannot be read back — no" >&2
    echo "amount of pulling will retrieve them. Copy the connection string from" >&2
    echo "the database dashboard instead and re-run as:" >&2
    echo >&2
    echo "  DATABASE_URL='postgres://…' bash scripts/migrateProduction.sh" >&2
  fi
  echo >&2
  # Names and URL schemes are not secrets, so listing every variable is safe and
  # says whether the file is malformed, empty, or simply has no usable URL.
  echo "$ENV_FILE holds $(wc -l < "$ENV_FILE") lines, $(wc -c < "$ENV_FILE") bytes." >&2
  echo "Variables found (names and schemes only, values not shown):" >&2
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) printf '  (unparsed line)\n' >&2; continue ;; esac
    name="${line%%=*}"
    value="${line#*=}"
    value="${value%\"}"
    value="${value#\"}"
    case "$value" in
      *://*)         printf '  %s = %s://…\n' "$name" "${value%%://*}" >&2 ;;
      '')            printf '  %s = (empty)\n' "$name" >&2 ;;
      '[SENSITIVE]') printf '  %s = [SENSITIVE], unreadable\n' "$name" >&2 ;;
      *)             printf '  %s = (not a URL)\n' "$name" >&2 ;;
    esac
  done < "$ENV_FILE"
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
deploy_output="$(DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy 2>&1 || true)"
printf '%s\n' "$deploy_output"

# P3005 means the tables already exist but no migration was ever recorded —
# typically a schema first created with `db push`. The migration cannot be
# replayed over them, so the history has to be baselined instead. That is only
# sound if what is already deployed matches what the migration would have
# built: `migrate diff` renders the SQL that would still be needed to reach the
# target schema, and an empty result is proof there is nothing left to apply.
if printf '%s' "$deploy_output" | grep -q 'P3005'; then
  echo
  echo "==> Database already has tables; checking it matches the schema"
  drift_status=0
  drift="$(DATABASE_URL="$DATABASE_URL" npx prisma migrate diff \
    --from-url "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.prisma \
    --script --exit-code 2>&1)" || drift_status=$?

  if [ "$drift_status" -ne 0 ]; then
    echo >&2
    echo "The deployed schema differs from prisma/schema.prisma, so the history" >&2
    echo "cannot be baselined — recording the migration as applied would hide" >&2
    echo "this drift. SQL still needed to reach the target schema:" >&2
    echo >&2
    printf '%s\n' "$drift" >&2
    echo >&2
    echo "Nothing was changed. Reconcile the schema before migrating." >&2
    exit 1
  fi

  echo "    No drift — the deployed schema already matches the target."
  for name in $pending; do
    echo "==> Recording $name as applied"
    DATABASE_URL="$DATABASE_URL" npx prisma migrate resolve --applied "$name"
  done
elif printf '%s' "$deploy_output" | grep -qE 'Error: P[0-9]{4}'; then
  echo >&2
  echo "Migration failed; see the error above." >&2
  exit 1
fi

echo
echo "==> Migration status after applying"
DATABASE_URL="$DATABASE_URL" npx prisma migrate status
