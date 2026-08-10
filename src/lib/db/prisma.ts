import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Interactive transactions default to a 5s budget, which is measured in wall
 * clock time and therefore spent mostly on network round trips once the
 * database is not on localhost. A turn's writes are batched (see persistTurn)
 * so they no longer need anywhere near this much, but the ceiling is raised as
 * well: exceeding it aborts the transaction with P2028 and costs the user their
 * answer, which is a far worse outcome than a slow request.
 */
export const TRANSACTION_TIMEOUT_MS = 20_000;
export const TRANSACTION_MAX_WAIT_MS = 10_000;

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Without this guard the pg adapter falls back to its libpq defaults and the
    // failure surfaces as "Can't reach database server at 127.0.0.1:5432", which
    // says nothing about the variable that is actually missing.
    throw new Error("DATABASE_URL is not set.");
  }
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    transactionOptions: {
      timeout: TRANSACTION_TIMEOUT_MS,
      maxWait: TRANSACTION_MAX_WAIT_MS,
    },
  });
}

let client: PrismaClient | undefined;

function getClient(): PrismaClient {
  if (!client) {
    client = globalForPrisma.prisma ?? createClient();
    if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  }
  return client;
}

/**
 * Construction is deferred to first use: `next build` imports the route modules
 * to collect page data and is not guaranteed to have DATABASE_URL, so touching
 * the connection at module scope would fail the build rather than the request.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const instance = getClient();
    const value = Reflect.get(instance, property, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
