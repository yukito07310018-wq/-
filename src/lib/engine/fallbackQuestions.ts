import fallbackFile from "../../../data/fallbackQuestions.json";
import { FallbackQuestionsFileSchema } from "../validation/schemas";
import { isDuplicateQuestion } from "./questionSelector";
import type { AskedQuestion, QuestionCandidate } from "../types/diagnosis";

/**
 * The pre-authored questions: the four thin openers the interview enters on,
 * and the rest as a safety net for when Call B is unavailable.
 *
 * Selection here is by file order and nothing else. It used to rank candidates
 * by which axis had the least coverage, which meant every fallback jumped to a
 * different subject than the one before it — the opposite of what an interview
 * that is trying to stay on a topic needs. The opening pick used to be
 * `Math.random()`; that is gone too, both because the interview should be
 * reproducible and because "the first opener not yet used" is exactly the rule
 * needed to hand out the remaining openers when a topic runs dry.
 */

const parsed = FallbackQuestionsFileSchema.safeParse(fallbackFile);
if (!parsed.success) {
  throw new Error("data/fallbackQuestions.json の検証に失敗しました。");
}

export const FALLBACK_QUESTIONS = parsed.data.questions;

/** The thin, broad questions the user picks a subject from. */
export const OPENING_QUESTIONS = FALLBACK_QUESTIONS.filter((q) => q.opening);

function toCandidate(q: (typeof FALLBACK_QUESTIONS)[number]): QuestionCandidate {
  return {
    question_id: q.question_id,
    text: q.text,
    target_elements: q.target_elements,
    probe_kind: q.probe_kind,
    expected_yield: q.expected_yield,
    rationale: "opening",
  };
}

/**
 * The first opener not yet used, in file order.
 *
 * Serves both entries into a topic: the very first question of the interview,
 * and the move to a new subject once the current one is finished. Null once all
 * four have been spent — the caller then asks Call B for a fresh subject.
 */
export function pickOpeningQuestion(
  asked: readonly AskedQuestion[] = []
): QuestionCandidate | null {
  const unused = OPENING_QUESTIONS.find((q) => !isDuplicateQuestion(q.text, asked));
  return unused ? toCandidate(unused) : null;
}

/**
 * The first unused pre-authored question, in file order.
 * Returns null only when every fallback has already been asked.
 */
export function pickFallbackQuestion(
  asked: readonly AskedQuestion[],
  bannedProbeKinds: readonly string[] = []
): QuestionCandidate | null {
  const banned = new Set(bannedProbeKinds);
  const available = FALLBACK_QUESTIONS.find(
    (q) => !banned.has(q.probe_kind) && !isDuplicateQuestion(q.text, asked)
  );
  return available ? toCandidate(available) : null;
}
