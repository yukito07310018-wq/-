import { maxSimilarity, trigramJaccard } from "./similarity";
import type { AskedQuestion, QuestionCandidate } from "../types/diagnosis";

/**
 * Choosing between the candidates Call B proposes.
 *
 * There used to be a five-term QValue here — uncertainty, information gain,
 * contradiction relevance, diversity, evidence importance — ranking candidates
 * by which under-measured elements they aimed at. All five read per-turn
 * extraction state that no longer exists, and the premise underneath them does
 * not hold either: a question cannot be aimed at an element, because any answer
 * touches many at once.
 *
 * What survives is the one rule that was never about elements: do not ask the
 * same question twice. Among the candidates that clear it, the model's own
 * first choice is taken.
 */

/** Candidates more similar than this to any past question are dropped outright. */
export const SIMILARITY_EXCLUSION = 0.75;

export interface SelectionContext {
  askedQuestions: readonly AskedQuestion[];
}

/**
 * The first candidate that is not a near-repeat of something already asked.
 * Null when every candidate is a duplicate — the caller retries Call B once,
 * then falls back to a pre-authored question.
 */
export function selectQuestion(
  candidates: readonly QuestionCandidate[],
  ctx: SelectionContext
): QuestionCandidate | null {
  const asked = ctx.askedQuestions.map((q) => q.text);
  for (const candidate of candidates) {
    if (maxSimilarity(candidate.text, asked) <= SIMILARITY_EXCLUSION) return candidate;
  }
  return null;
}

/** Guards against the same question text being asked twice, whatever the source. */
export function isDuplicateQuestion(text: string, asked: readonly AskedQuestion[]): boolean {
  return asked.some((q) => trigramJaccard(text, q.text) > SIMILARITY_EXCLUSION);
}
