import { runReaderCall } from "../ai/readerCall";
import { ModelOutputTruncatedError } from "../ai/client";
import { summarizeTopics } from "../engine/returns";
import { hasEnoughTurnsToRead, MIN_TURNS_FOR_READING } from "../engine/terminationEngine";
import { ELEMENT_IDS } from "../model/elements";
import * as repo from "../db/repository";
import type { ConversationMessage, SessionRecord } from "../db/repository";
import type { Reading, ReadingSegment } from "../types/reading";

/**
 * The batch reading: one pass over a finished conversation, run once.
 *
 * "Once" is load-bearing in two directions. It is once per session because a
 * reading is the product and re-deriving it on every page view would both cost
 * a model call and quietly change what the person was told last time. And it is
 * once per *conversation* rather than once per turn because the thing being
 * looked for — a subject they left and came back to — does not exist inside any
 * single utterance.
 */

export type ReadingOutcome =
  | { status: "ready"; reading: Reading }
  /** Not enough conversation to read. Nothing was called and nothing is stored. */
  | { status: "too_short"; turnCount: number; required: number }
  /** Stopped by the safety gate. §9.2 — this session is never read or shown. */
  | { status: "aborted" }
  | { status: "not_found" }
  /** The model's answer was cut off. Deliberately loud — see `client.ts`. */
  | { status: "truncated"; message: string }
  | { status: "failed"; message: string };

/** Everything the reading touches, injected so it can run without a database. */
export interface ReadingPorts {
  getSession(sessionId: string): Promise<SessionRecord | null>;
  loadReading(sessionId: string): Promise<Reading | null>;
  saveReading(reading: Reading): Promise<void>;
  loadConversation(sessionId: string): Promise<ConversationMessage[]>;
  readConversation(conversation: readonly ConversationMessage[]): Promise<ReadingSegment[]>;
}

export const livePorts: ReadingPorts = {
  getSession: repo.getSession,
  loadReading: repo.loadReading,
  saveReading: repo.saveReading,
  loadConversation: repo.loadConversation,
  readConversation: async (conversation) => {
    const result = await runReaderCall({ conversation, elementIds: ELEMENT_IDS });
    return result.segments;
  },
};

/**
 * Returns the session's reading, producing it first if it does not exist yet.
 *
 * The order of the guards is the whole design: a stored reading short-circuits
 * before anything else, and a session too short to be worth reading is turned
 * away before the model is called rather than after.
 */
export async function runReading(
  sessionId: string,
  ports: ReadingPorts
): Promise<ReadingOutcome> {
  const session = await ports.getSession(sessionId);
  if (!session) return { status: "not_found" };

  // §9.2 — a session the safety gate stopped is not read and not shown, however
  // it is reached. The interview screen hides its own controls after a crisis,
  // but this URL is reachable directly and the guard has to live here.
  if (session.status === "aborted") return { status: "aborted" };

  const stored = await ports.loadReading(sessionId);
  if (stored) return { status: "ready", reading: stored };

  if (!hasEnoughTurnsToRead(session.turnCount)) {
    return {
      status: "too_short",
      turnCount: session.turnCount,
      required: MIN_TURNS_FOR_READING,
    };
  }

  const conversation = await ports.loadConversation(sessionId);

  let segments: ReadingSegment[];
  try {
    segments = await ports.readConversation(conversation);
  } catch (error) {
    // Nothing is stored on failure, so the next request retries rather than
    // pinning an empty reading to the session forever. The old code caught an
    // exception here, substituted "no evidence", and reported success — which
    // is how a whole session's output went missing without a single error line.
    if (error instanceof ModelOutputTruncatedError) {
      console.error(`[readingService] reading truncated for ${sessionId}:`, error);
      return { status: "truncated", message: error.message };
    }
    console.error(`[readingService] reading failed for ${sessionId}:`, error);
    return {
      status: "failed",
      message: "読み取りに失敗しました。時間をおいて、もう一度この画面を開いてください。",
    };
  }

  const reading: Reading = {
    session_id: sessionId,
    turn_count: session.turnCount,
    topics: summarizeTopics(segments),
  };

  await ports.saveReading(reading);
  return { status: "ready", reading };
}

/** `runReading` against the real database and the real model. */
export async function readSession(sessionId: string): Promise<ReadingOutcome> {
  return runReading(sessionId, livePorts);
}
