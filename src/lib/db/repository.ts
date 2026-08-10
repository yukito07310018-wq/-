import { customAlphabet } from "nanoid";
import { prisma } from "./prisma";
import { ELEMENT_IDS } from "../model/elements";
import { INITIAL_CONFIDENCE, INITIAL_SCORE } from "../engine/scoreEngine";
import { EVIDENCE_TYPES, PROBE_KINDS } from "../types/diagnosis";
import type {
  AskedQuestion,
  AxisAggregate,
  Contradiction,
  ElementState,
  Evidence,
  EvidenceDirection,
  EvidenceType,
  ProbeKind,
} from "../types/diagnosis";

/**
 * The only place that knows arrays are stored as JSON strings.
 * Domain code above this layer sees real arrays and typed unions.
 */

const SESSION_ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const newSessionId = customAlphabet(SESSION_ID_ALPHABET, 21);

/**
 * Ids for rows this module inserts. Assigning them here rather than letting the
 * database generate them is what allows a turn's inserts to be batched: nothing
 * in the batch has to wait for an id produced by an earlier statement.
 */
const newRowId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 24);

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

function asEvidenceType(value: string): EvidenceType {
  return (EVIDENCE_TYPES as readonly string[]).includes(value)
    ? (value as EvidenceType)
    : "explicit_statement";
}

function asDirection(value: string): EvidenceDirection {
  return value === "positive" || value === "negative" ? value : "neutral";
}

function asProbeKind(value: string): ProbeKind {
  return (PROBE_KINDS as readonly string[]).includes(value) ? (value as ProbeKind) : "experience";
}

/* -------------------------------------------------------------------------- */
/* Session lifecycle                                                          */
/* -------------------------------------------------------------------------- */

/** Creates a session and its 100 element rows in a single transaction (§27). */
export async function createSession(): Promise<string> {
  const id = newSessionId();
  // Batched rather than interactive for the same reason as persistTurn: neither
  // statement depends on the other's result, so there is nothing to gain from
  // paying a round trip between them.
  await prisma.$transaction([
    prisma.session.create({ data: { id } }),
    prisma.elementState.createMany({
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
    }),
  ]);
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
 * How long a held lock is trusted before another request may take it over.
 * Must exceed the longest legitimate turn — the route caps itself at
 * `maxDuration = 120s`, so nothing honest is still running after this.
 */
export const SESSION_LOCK_TTL_MS = 180_000;

/**
 * Claims the session for processing (§24 idempotency).
 * Returns false when another request already holds it — the conditional update
 * makes this atomic, so two concurrent POSTs cannot both win.
 *
 * The lock is released in a `finally`, but that only runs if the process
 * survives: a serverless invocation killed mid-turn leaves `processing` set
 * with nobody to clear it, and without an expiry the session would answer
 * SESSION_BUSY forever. `updatedAt` is maintained by Prisma on every write to
 * the row, so a lock whose row has gone untouched for the TTL is stale by
 * definition and can be taken over.
 */
export async function acquireSessionLock(sessionId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - SESSION_LOCK_TTL_MS);
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      OR: [{ processing: false }, { updatedAt: { lt: staleBefore } }],
    },
    data: { processing: true },
  });
  return result.count === 1;
}

export async function releaseSessionLock(sessionId: string): Promise<void> {
  await prisma.session.updateMany({ where: { id: sessionId }, data: { processing: false } });
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

export async function loadElementStates(sessionId: string): Promise<Map<string, ElementState>> {
  const rows = await prisma.elementState.findMany({
    where: { sessionId },
    include: { histories: { orderBy: { turn: "asc" } } },
  });

  const map = new Map<string, ElementState>();
  for (const row of rows) {
    map.set(row.elementId, {
      element_id: row.elementId,
      score: row.score,
      confidence: row.confidence,
      evidence_count: row.evidenceCount,
      evidence_diversity: row.evidenceDiversity,
      evidence_type_set: parseStringArray(row.evidenceTypes),
      last_updated_turn: row.lastUpdatedTurn,
      history: row.histories.map((h) => ({
        turn: h.turn,
        score: h.score,
        confidence: h.confidence,
        delta: h.delta,
        cause_evidence_ids: parseStringArray(h.causeEvidenceIds),
      })),
    });
  }
  return map;
}

export async function loadEvidence(sessionId: string): Promise<Evidence[]> {
  const rows = await prisma.evidence.findMany({
    where: { sessionId },
    orderBy: [{ turnId: "asc" }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    evidence_id: r.id,
    turn_id: r.turnId,
    element_id: r.elementId,
    quote: r.quote,
    type: asEvidenceType(r.type),
    strength: r.strength,
    reliability: r.reliability,
    direction: asDirection(r.direction),
    context: r.context,
  }));
}

export async function loadContradictions(sessionId: string): Promise<Contradiction[]> {
  const rows = await prisma.contradiction.findMany({
    where: { sessionId },
    orderBy: { detectedTurn: "asc" },
  });
  return rows.map((r) => ({
    contradiction_id: r.id,
    elements: parseStringArray(r.elementIds),
    evidence_a: r.evidenceAId,
    evidence_b: r.evidenceBId,
    severity: r.severity,
    status: r.status === "resolved" ? "resolved" : "unresolved",
    detected_turn: r.detectedTurn,
    resolution_note: r.resolutionNote ?? undefined,
  }));
}

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
    q_value: r.qValue,
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

/** Mean confidence at the end of each past turn, for the saturation check (§33). */
export async function loadMeanConfidenceHistory(sessionId: string): Promise<number[]> {
  const rows = await prisma.axisSnapshot.findMany({
    where: { sessionId },
    orderBy: { turn: "asc" },
    select: { turn: true, confidence: true },
  });
  const byTurn = new Map<number, number[]>();
  for (const r of rows) {
    const list = byTurn.get(r.turn);
    if (list) list.push(r.confidence);
    else byTurn.set(r.turn, [r.confidence]);
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, values]) => values.reduce((s, v) => s + v, 0) / values.length);
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
      qValue: question.q_value,
    },
  });
}

export interface PersistTurnInput {
  sessionId: string;
  turn: number;
  /** Evidence with app-assigned ids; ids are re-mapped to DB ids on insert. */
  evidence: Evidence[];
  changedStates: Map<string, ElementState>;
  newContradictions: Contradiction[];
  resolutions: { contradiction_id: string; resolution_note: string }[];
  axes: AxisAggregate[];
}

/**
 * Persists one turn's model update atomically.
 *
 * Written as a *batched* transaction rather than an interactive one. The
 * interactive form issues one round trip per statement, and a turn at the
 * §9.2 intake limits produces 33 of them (8 evidence + 6 state updates + 6
 * score histories + 10 axis snapshots + bookkeeping). Against a hosted
 * database those round trips alone exceed the transaction budget — the
 * transaction expires mid-write with P2028 and the user loses the answer they
 * just typed. Batching sends the whole turn as one unit of work, so cost stops
 * scaling with round-trip latency.
 *
 * Row ids are assigned up front so that no statement depends on the result of
 * an earlier one; the provisional ids used by the engine are translated so
 * contradictions and score histories keep pointing at the right rows.
 */
export async function persistTurn(input: PersistTurnInput): Promise<void> {
  const { sessionId, turn } = input;

  const idMap = new Map<string, string>(input.evidence.map((e) => [e.evidence_id, newRowId()]));
  const mapId = (provisional: string) => idMap.get(provisional) ?? provisional;

  // ScoreHistory is keyed by ElementState.id, so the id of each row has to be
  // known before the batch is assembled. Read outside the transaction: it is a
  // single query and it does not need to be part of the atomic write.
  const stateRows = await prisma.elementState.findMany({
    where: { sessionId },
    select: { id: true, elementId: true },
  });
  const stateIdByElement = new Map(stateRows.map((r) => [r.elementId, r.id]));

  const stateUpdates = [];
  const historyRows = [];

  for (const [elementId, state] of input.changedStates) {
    const stateId = stateIdByElement.get(elementId);
    if (!stateId) {
      // The 100 rows are created with the session, so this only happens if the
      // element model gained an element after this session started. Skipping
      // costs one element's history; aborting would cost the whole turn.
      console.warn(`[repository] no ElementState row for ${elementId} — skipping`);
      continue;
    }

    stateUpdates.push(
      prisma.elementState.update({
        where: { id: stateId },
        data: {
          score: state.score,
          confidence: state.confidence,
          evidenceCount: state.evidence_count,
          evidenceDiversity: state.evidence_diversity,
          evidenceTypes: serializeStringArray(state.evidence_type_set),
          lastUpdatedTurn: state.last_updated_turn,
        },
      })
    );

    const latest = state.history[state.history.length - 1];
    if (latest && latest.turn === turn) {
      historyRows.push({
        elementStateId: stateId,
        turn: latest.turn,
        score: latest.score,
        confidence: latest.confidence,
        delta: latest.delta,
        causeEvidenceIds: serializeStringArray(latest.cause_evidence_ids.map(mapId)),
      });
    }
  }

  const evidenceRows = input.evidence.map((e) => ({
    id: mapId(e.evidence_id),
    sessionId,
    turnId: e.turn_id,
    elementId: e.element_id,
    quote: e.quote,
    type: e.type,
    strength: e.strength,
    reliability: e.reliability,
    direction: e.direction,
    context: e.context,
  }));

  const contradictionRows = input.newContradictions.map((c) => ({
    sessionId,
    elementIds: serializeStringArray(c.elements),
    evidenceAId: mapId(c.evidence_a),
    evidenceBId: mapId(c.evidence_b),
    severity: c.severity,
    status: c.status,
    detectedTurn: c.detected_turn,
  }));

  await prisma.$transaction([
    ...(evidenceRows.length > 0 ? [prisma.evidence.createMany({ data: evidenceRows })] : []),
    ...stateUpdates,
    ...(historyRows.length > 0 ? [prisma.scoreHistory.createMany({ data: historyRows })] : []),
    ...(contradictionRows.length > 0
      ? [prisma.contradiction.createMany({ data: contradictionRows })]
      : []),
    ...input.resolutions.map((r) =>
      prisma.contradiction.updateMany({
        where: { id: r.contradiction_id, sessionId },
        data: { status: "resolved", resolutionNote: r.resolution_note },
      })
    ),
    ...(input.axes.length > 0
      ? [
          prisma.axisSnapshot.createMany({
            data: input.axes.map((axis) => ({
              sessionId,
              turn,
              axisId: axis.axis_id,
              score: axis.score,
              confidence: axis.confidence,
              coverage: axis.coverage,
            })),
          }),
        ]
      : []),
    prisma.session.update({ where: { id: sessionId }, data: { turnCount: turn } }),
  ]);
}
