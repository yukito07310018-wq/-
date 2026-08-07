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

export interface TurnDiagnosticRecord {
  turn: number;
  analystOk: boolean;
  analystError: string | null;
  extracted: number;
  accepted: number;
  rejected: number;
  rejectedReasons: Record<string, number>;
  repaired: boolean;
  droppedByLimits: number;
  questionSource: QuestionSource;
}

/** Where the next question came from — "none" when the turn ended the interview. */
export type QuestionSource = "llm" | "fallback" | "exhausted" | "none";

function parseCountMap(raw: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function asQuestionSource(value: string): QuestionSource {
  return value === "fallback" || value === "exhausted" || value === "llm" ? value : "none";
}

export async function loadTurnDiagnostics(sessionId: string): Promise<TurnDiagnosticRecord[]> {
  const rows = await prisma.turnDiagnostic.findMany({
    where: { sessionId },
    orderBy: { turn: "asc" },
  });
  return rows.map((r) => ({
    turn: r.turn,
    analystOk: r.analystOk,
    analystError: r.analystError,
    extracted: r.extracted,
    accepted: r.accepted,
    rejected: r.rejected,
    rejectedReasons: parseCountMap(r.rejectedReasons),
    repaired: r.repaired,
    droppedByLimits: r.droppedByLimits,
    questionSource: asQuestionSource(r.questionSource),
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
  /** Why this turn produced the evidence it did; written in the same transaction. */
  diagnostic: Omit<TurnDiagnosticRecord, "turn" | "questionSource">;
}

/**
 * Persists one turn's model update atomically.
 *
 * Evidence rows get their DB-generated ids here; the provisional ids used by the
 * engine are translated so contradictions and score histories keep pointing at
 * the right rows.
 */
export async function persistTurn(input: PersistTurnInput): Promise<void> {
  const { sessionId, turn } = input;

  await prisma.$transaction(async (tx) => {
    const idMap = new Map<string, string>();

    for (const e of input.evidence) {
      const created = await tx.evidence.create({
        data: {
          sessionId,
          turnId: e.turn_id,
          elementId: e.element_id,
          quote: e.quote,
          type: e.type,
          strength: e.strength,
          reliability: e.reliability,
          direction: e.direction,
          context: e.context,
        },
        select: { id: true },
      });
      idMap.set(e.evidence_id, created.id);
    }

    const mapId = (provisional: string) => idMap.get(provisional) ?? provisional;

    for (const [elementId, state] of input.changedStates) {
      const updated = await tx.elementState.update({
        where: { sessionId_elementId: { sessionId, elementId } },
        data: {
          score: state.score,
          confidence: state.confidence,
          evidenceCount: state.evidence_count,
          evidenceDiversity: state.evidence_diversity,
          evidenceTypes: serializeStringArray(state.evidence_type_set),
          lastUpdatedTurn: state.last_updated_turn,
        },
        select: { id: true },
      });

      const latest = state.history[state.history.length - 1];
      if (latest && latest.turn === turn) {
        await tx.scoreHistory.create({
          data: {
            elementStateId: updated.id,
            turn: latest.turn,
            score: latest.score,
            confidence: latest.confidence,
            delta: latest.delta,
            causeEvidenceIds: serializeStringArray(latest.cause_evidence_ids.map(mapId)),
          },
        });
      }
    }

    for (const c of input.newContradictions) {
      await tx.contradiction.create({
        data: {
          sessionId,
          elementIds: serializeStringArray(c.elements),
          evidenceAId: mapId(c.evidence_a),
          evidenceBId: mapId(c.evidence_b),
          severity: c.severity,
          status: c.status,
          detectedTurn: c.detected_turn,
        },
      });
    }

    for (const r of input.resolutions) {
      await tx.contradiction.updateMany({
        where: { id: r.contradiction_id, sessionId },
        data: { status: "resolved", resolutionNote: r.resolution_note },
      });
    }

    for (const axis of input.axes) {
      await tx.axisSnapshot.create({
        data: {
          sessionId,
          turn,
          axisId: axis.axis_id,
          score: axis.score,
          confidence: axis.confidence,
          coverage: axis.coverage,
        },
      });
    }

    const d = input.diagnostic;
    await tx.turnDiagnostic.upsert({
      where: { sessionId_turn: { sessionId, turn } },
      create: {
        sessionId,
        turn,
        analystOk: d.analystOk,
        analystError: d.analystError,
        extracted: d.extracted,
        accepted: d.accepted,
        rejected: d.rejected,
        rejectedReasons: JSON.stringify(d.rejectedReasons),
        repaired: d.repaired,
        droppedByLimits: d.droppedByLimits,
      },
      update: {
        analystOk: d.analystOk,
        analystError: d.analystError,
        extracted: d.extracted,
        accepted: d.accepted,
        rejected: d.rejected,
        rejectedReasons: JSON.stringify(d.rejectedReasons),
        repaired: d.repaired,
        droppedByLimits: d.droppedByLimits,
      },
    });

    await tx.session.update({ where: { id: sessionId }, data: { turnCount: turn } });
  });
}

/**
 * Records where the next question came from, once it is known.
 *
 * Deliberately outside persistTurn's transaction and non-fatal: this is
 * observability, and it must never be able to fail an interview turn.
 */
export async function recordQuestionSource(
  sessionId: string,
  turn: number,
  source: QuestionSource
): Promise<void> {
  try {
    await prisma.turnDiagnostic.updateMany({
      where: { sessionId, turn },
      data: { questionSource: source },
    });
  } catch (error) {
    console.error("[repository] failed to record question source:", error);
  }
}
