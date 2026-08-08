/**
 * Applies pending migrations at build time, without being able to fail the build.
 *
 * Migrations used to be entirely manual here, and the README explains why: an
 * earlier build ran `prisma db push --accept-data-loss`, which reapplied the
 * schema destructively on every deploy. That reasoning does not extend to
 * `prisma migrate deploy`, which is forward-only, idempotent, tracked in
 * `_prisma_migrations`, and never drops anything — it is the command Prisma
 * documents for production.
 *
 * Leaving it manual had a real cost: a deploy would land with code that expects
 * a table nobody had created yet, and the person who could run the command was
 * not necessarily the person who noticed. Now it happens on its own.
 *
 * A failure here is never fatal. If DATABASE_URL is absent at build time, or
 * the database is unreachable from the builder, the build still finishes and
 * the app still runs — the diagnostic table is optional by design, and
 * /api/health reports it if it is missing.
 */
import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("[build] DATABASE_URL is unset — skipping migrations.");
  process.exit(0);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  console.warn(
    "[build] prisma migrate deploy did not succeed. Continuing — the build must not " +
      "depend on the database being reachable. Check /api/health after deploying."
  );
}

process.exit(0);
