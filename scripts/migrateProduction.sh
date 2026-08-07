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

# Read DATABASE_URL out of the pulled file without exporting the rest of it;
# the file also carries POSTGRES_URL and postgres_prisma_* aliases that Prisma
# would happily connect to instead if they leaked into the environment.
DATABASE_URL="$(grep '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')"

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not present in $ENV_FILE" >&2
  exit 1
fi

# Show the target with the password blanked, so the host can be eyeballed
# without printing the credential to a terminal or CI log.
masked="$(printf '%s' "$DATABASE_URL" | sed -E 's#(://[^:]+:)[^@]+(@)#\1****\2#')"
echo
echo "==> Target database"
echo "    $masked"

echo
echo "==> Migration status before applying"
DATABASE_URL="$DATABASE_URL" npx prisma migrate status || true

echo
read -r -p "Apply the migrations above to THIS database? (yes/no) " reply
if [ "$reply" != "yes" ]; then
  echo "Aborted; nothing was applied."
  exit 1
fi

echo
echo "==> Applying migrations"
DATABASE_URL="$DATABASE_URL" npx prisma migrate deploy

echo
echo "==> Migration status after applying"
DATABASE_URL="$DATABASE_URL" npx prisma migrate status
