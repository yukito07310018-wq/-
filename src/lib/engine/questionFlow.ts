import type { AnswerSignal, AskedQuestion, QuestionMode } from "../types/diagnosis";

/**
 * How long the interview stays on one topic.
 *
 * A topic block is one entry question plus up to three deepenings. Staying put
 * is the whole point: the thing worth finding is what a person returns to, and
 * a question that hops to a new subject every turn makes returning impossible
 * to observe — every mention would be a first mention.
 *
 * The counting rule that pairs with this lives in the reading: repetition
 * *inside* a block is never counted as the user coming back, because the user
 * did not come back, we kept them there.
 */
export const TOPIC_TURNS = 4;

/** The modes that begin a new topic — the boundary the reading counts against. */
const TOPIC_BOUNDARY: readonly QuestionMode[] = ["opening", "switch"];

/**
 * Questions asked in the current topic block, counting the one that opened it.
 * A history with no boundary at all (only ever `deepen`, which should not
 * happen) counts the whole history rather than reporting zero.
 */
export function topicRun(asked: readonly AskedQuestion[]): number {
  for (let i = asked.length - 1; i >= 0; i--) {
    if (TOPIC_BOUNDARY.includes(asked[i].mode)) return asked.length - i;
  }
  return asked.length;
}

/**
 * The mode the next question should take.
 *
 * Deterministic in the turn history; the one input that can come from the model
 * is the signal it read in the last answer, and only `flat_unknown` changes the
 * outcome. Everything else — including a user who cannot phrase it and reaches
 * for an analogy — keeps the interview where it is.
 */
export function nextMode(
  asked: readonly AskedQuestion[],
  signal: AnswerSignal = "normal"
): QuestionMode {
  if (asked.length === 0) return "opening";
  if (signal === "flat_unknown") return "switch";
  return topicRun(asked) >= TOPIC_TURNS ? "switch" : "deepen";
}
