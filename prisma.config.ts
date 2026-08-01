import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: path.join("prisma", "migrations") },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
