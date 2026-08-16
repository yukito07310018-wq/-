import { customAlphabet } from "nanoid";
import { prisma } from "./prisma";
import { ELEMENT_IDS } from "../model/elements";
import { INITIAL_CONFIDENCE, INITIAL_SCORE } from "../engine/scoreEngine";
import { PROBE_KINDS, QUESTION_MODES } from "../types/diagnosis";
import type { AskedQuestion, ProbeKind, QuestionMode } from "../types/diagnosis";
import type { Reading, ReadingTopic } from "../types/reading";

/**
 * The only place that knows arrays are stored as JSON strings.
 * Domain code above this layer sees real arrays and typed unions.
 */

const SESSION_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const newSessionId = customAlphabet(SESSION_ID_ALPHABET, 21);

function parseStringArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

function serializeStringArray(values: readonly string[]): string {
  return JSON.stringify(values);
}

function asProbeKind(value: string): ProbeKind {
  return (PROBE_KINDS as readonly string[]).includes(value) ? (value as ProbeKind) : "experience";
}

function asQuestionMode(value: string): QuestionMode {
  return (QUESTION_MODES as readonly string[]).includes(value)
    ? (value as QuestionMode)
    : "deepen";
}

/* -------------------------------------------------------------------------- */
/* Session lifecycle                                                          */
/* -------------------------------------------------------------------------- */

/** Creates a session and its 100 element rows in a single transaction (§27). */
export async function createSession(): Promise<string> {
  const id = newSessionId();
  await prisma.$transaction(async (tx) => {
    await tx.session.create({ data: { id } });
    await tx.elementState.createMany({
      data: ELEMENT_IDS.map((elementId) => ({
        sessionId: id,
        elementId,
        score: INITIAL_SCORE,
        confidence: INITIAL_CONFIDENCE,
        evidenceCount: 0,
        evidenceDiversity: 0,
        evidenceTypes: "[]",
        lastUpdatedTurn: 0,
      })),
    });
  });
  return id;
}

export interface SessionRecord {
  id: string;
  status: string;
  processing: boolean;
  turnCount: number;
}

export async function getSession(sessionId: string): Promise<SessionRecord | null> {
  const s = await prisma.session.findUnique({
    where: { id: sessionId },
    select: { id: true, status: true, processing: true, turnCount: true },
  });
  return s;
}

/**
 * Claims the session for processing (§24 idempotency).
 * Returns false when another request already holds it — the conditional update
 * makes this atomic, so two concurrent POSTs cannot both win.
 */
export async function acquireSessionLock(sessionId: string): Promise<boolean> {
  const result = await prisma.session.updateMany({
    where: { id: sessionId, processing: false },
    data: { processing: true },
  });
  return result.count === 1;
}

export async function releaseSessionLock(sessionId: string): Promise<void> {
  await prisma.session.updateMany({ where: { id: sessionId }, data: { processing: false } });
}

export async function setTurnCount(sessionId: string, turn: number): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { turnCount: turn } });
}

export async function setSessionStatus(
  sessionId: string,
  status: "active" | "completed" | "aborted"
): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { status } });
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  const existing = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true } });
  if (!existing) return false;
  // Every child relation is onDelete: Cascade, so this removes all evidence too.
  await prisma.session.delete({ where: { id: sessionId } });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

/*
 * There is deliberately no reader here for ElementState, Evidence, ScoreHistory,
 * Contradiction or AxisSnapshot. Those tables and the pure engines that fill
 * them are kept — the schema is unchanged and `lib/engine/*` still computes
 * exactly what it always did — but nothing in the request path reads or writes
 * them any more. Leaving the accessors in place would let the sequential
 * extraction grow back one call at a time; without them, reconnecting it is a
 * visible, deliberate act.
 */

export async function loadAskedQuestions(sessionId: string): Promise<AskedQuestion[]> {
  const rows = await prisma.questionHistory.findMany({
    where: { sessionId },
    orderBy: { turn: "asc" },
  });
  return rows.map((r) => ({
    turn: r.turn,
    text: r.text,
    target_elements: parseStringArray(r.targetElements),
    probe_kind: asProbeKind(r.probeKind),
    mode: asQuestionMode(r.mode),
  }));
}

export interface ConversationMessage {
  turnIndex: number;
  role: "user" | "assistant";
  content: string;
}

export async function loadConversation(
  sessionId: string,
  limit?: number
): Promise<ConversationMessage[]> {
  const rows = await prisma.conversationTurn.findMany({
    where: { sessionId },
    orderBy: [{ turnIndex: "asc" }, { role: "asc" }],
  });
  const mapped: ConversationMessage[] = rows.map((r) => ({
    turnIndex: r.turnIndex,
    role: r.role === "user" ? "user" : "assistant",
    content: r.content,
  }));
  return limit ? mapped.slice(-limit) : mapped;
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

export async function saveConversationTurn(
  sessionId: string,
  turnIndex: number,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  await prisma.conversationTurn.upsert({
    where: { sessionId_turnIndex_role: { sessionId, turnIndex, role } },
    create: { sessionId, turnIndex, role, content },
    update: { content },
  });
}

export async function saveAskedQuestion(
  sessionId: string,
  question: AskedQuestion
): Promise<void> {
  await prisma.questionHistory.create({
    data: {
      sessionId,
      turn: question.turn,
      text: question.text,
      targetElements: serializeStringArray(question.target_elements),
      probeKind: question.probe_kind,
      mode: question.mode,
    },
  });
}

/*
 * `persistTurn` used to live here: one transaction writing a turn's evidence,
 * element states, score history, contradictions and axis snapshots. It is gone
 * along with the per-turn extraction that produced its input. Nothing writes to
 * those tables now.
 */

/* -------------------------------------------------------------------------- */
/* The reading                                                                 */
/* -------------------------------------------------------------------------- */

export async function loadReading(sessionId: string): Promise<Reading | null> {
  const row = await prisma.reading.findUnique({ where: { sessionId } });
  if (!row) return null;
  return {
    session_id: row.sessionId,
    turn_count: row.turnCount,
    topics: parseTopics(row.topics),
  };
}

/**
 * Stores the reading. Upsert rather than create so a retry after a partial
 * failure cannot collide with the unique constraint on sessionId.
 */
export async function saveReading(reading: Reading): Promise<void> {
  const data = {
    turnCount: reading.turn_count,
    topics: JSON.stringify(reading.topics),
  };
  await prisma.reading.upsert({
    where: { sessionId: reading.session_id },
    create: { sessionId: reading.session_id, ...data },
    update: data,
  });
}

function parseTopics(raw: string): ReadingTopic[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReadingTopic[]) : [];
  } catch {
    console.error("[repository] stored reading is not valid JSON");
    return [];
  }
}
