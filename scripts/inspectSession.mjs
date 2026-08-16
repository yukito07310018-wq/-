/**
 * Prints the stored row counts for one session — handy for confirming that a
 * turn actually persisted, or that DELETE cascaded everywhere.
 *
 *   node scripts/inspectSession.mjs <sessionId>
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const sessionId = process.argv[2];
if (!sessionId) {
  console.error("usage: node scripts/inspectSession.mjs <sessionId>");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const counts = {
  sessions: await prisma.session.count({ where: { id: sessionId } }),
  turns: await prisma.conversationTurn.count({ where: { sessionId } }),
  questions: await prisma.questionHistory.count({ where: { sessionId } }),
  readings: await prisma.reading.count({ where: { sessionId } }),
  // The extraction tables. Everything except elementStates (created with the
  // session and never touched again) should stay at 0 — a non-zero count here
  // means the per-turn extraction has been reconnected somewhere.
  elementStates: await prisma.elementState.count({ where: { sessionId } }),
  evidence: await prisma.evidence.count({ where: { sessionId } }),
  scoreHistory: await prisma.scoreHistory.count({ where: { elementState: { sessionId } } }),
  contradictions: await prisma.contradiction.count({ where: { sessionId } }),
  snapshots: await prisma.axisSnapshot.count({ where: { sessionId } }),
};

console.log(JSON.stringify(counts));

const reading = await prisma.reading.findUnique({ where: { sessionId } });
if (reading) {
  const topics = JSON.parse(reading.topics);
  console.log(`\nreading: ${reading.turnCount} turns, ${topics.length} topics`);
  for (const t of topics) {
    const mark = t.returns >= 2 ? ` (returns ${t.returns})` : "";
    console.log(`  ${t.element_id ?? "該当なし"}${mark}: ${t.quotes.length} quotes`);
    for (const q of t.quotes) console.log(`    turn ${q.turn}: ${q.text}`);
  }
} else {
  console.log("\nreading: not yet run");
}

await prisma.$disconnect();
