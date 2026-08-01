import fallbackFile from "../../../data/fallbackQuestions.json";
import { FallbackQuestionsFileSchema } from "../validation/schemas";
import { AXIS_IDS, primaryAxisOf } from "../model/axes";
import { isDuplicateQuestion } from "./questionSelector";
import type { AskedQuestion, ElementState, QuestionCandidate } from "../types/diagnosis";

/**
 * §17/§24 — the safety net when Call B fails or every candidate is a duplicate.
 * These are pre-authored so a question can always be asked, even with the AI
 * completely unavailable.
 */

const parsed = FallbackQuestionsFileSchema.safeParse(fallbackFile);
if (!parsed.success) {
  throw new Error("data/fallbackQuestions.json の検証に失敗しました。");
}

export const FALLBACK_QUESTIONS = parsed.data.questions;

function toCandidate(q: (typeof FALLBACK_QUESTIONS)[number]): QuestionCandidate {
  return {
    question_id: q.question_id,
    text: q.text,
    target_elements: q.target_elements,
    probe_kind: q.probe_kind,
    expected_yield: q.expected_yield,
    rationale: "fallback",
  };
}

/** The opening question (§24): broad, cross-axis, asked when no evidence exists. */
export function pickOpeningQuestion(): QuestionCandidate {
  const openers = FALLBACK_QUESTIONS.filter((q) => q.opening);
  const pool = openers.length > 0 ? openers : FALLBACK_QUESTIONS;
  return toCandidate(pool[Math.floor(Math.random() * pool.length)]);
}

/**
 * Picks an unused fallback, preferring one that probes the least-explored axis.
 * Returns null only if every fallback has already been asked.
 */
export function pickFallbackQuestion(
  asked: readonly AskedQuestion[],
  states: ReadonlyMap<string, ElementState>,
  bannedProbeKinds: readonly string[] = []
): QuestionCandidate | null {
  const banned = new Set(bannedProbeKinds);
  const available = FALLBACK_QUESTIONS.filter(
    (q) => !banned.has(q.probe_kind) && !isDuplicateQuestion(q.text, asked)
  );
  if (available.length === 0) return null;

  const coverageByAxis = new Map<string, number>();
  for (const axisId of AXIS_IDS) coverageByAxis.set(axisId, 0);
  for (const [elementId, state] of states) {
    if (state.evidence_count === 0) continue;
    const axis = primaryAxisOf([elementId]);
    if (axis) coverageByAxis.set(axis, (coverageByAxis.get(axis) ?? 0) + 1);
  }

  const ranked = [...available].sort((a, b) => {
    const axisA = primaryAxisOf(a.target_elements) ?? "";
    const axisB = primaryAxisOf(b.target_elements) ?? "";
    const covA = coverageByAxis.get(axisA) ?? 0;
    const covB = coverageByAxis.get(axisB) ?? 0;
    return covA - covB || a.question_id.localeCompare(b.question_id);
  });

  return toCandidate(ranked[0]);
}
