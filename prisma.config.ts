import "dotenv/config";
import path from "node:path";
import { defineConfig } from "prisma/config";

// `prisma generate` runs from postinstall and never opens a connection, but the
// config is loaded for every command. env("DATABASE_URL") throws when unset,
// which breaks `npm install` on hosts that only expose the variable to the
// build/runtime step. Fall back to an empty string and let the commands that
// actually connect (db push, migrate) surface the missing value instead.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: path.join("prisma", "migrations") },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
