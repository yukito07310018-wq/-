import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../generated/prisma/client";

/**
 * Prisma 7 takes the connection through an adapter rather than the schema file.
 * In dev the client is cached on globalThis so hot reload does not open a new
 * SQLite handle on every module reload.
 */

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
