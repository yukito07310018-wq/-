/**
 * §33 — when to stop asking.
 *
 * Quality gates can be met early by a talkative user, so a hard floor of 10
 * turns applies regardless; a hard ceiling of 30 prevents an endless interview.
 */
export const MIN_TURNS = 10;
export const MAX_TURNS = 30;
export const CONFIDENCE_TARGET = 0.75;
export const COVERAGE_TARGET = 0.7;
export const MAX_UNRESOLVED_CONTRADICTIONS = 3;
/** Mean-confidence growth below this over the last 3 turns counts as saturated. */
export const SATURATION_DELTA = 0.01;
export const SATURATION_WINDOW = 3;
/**
 * Saturation also requires this much accumulated confidence.
 *
 * Without it the rule fires on every session: a turn touches at most 6 of 100
 * elements, so mean confidence climbs by roughly 0.002-0.009 per turn and is
 * *always* below SATURATION_DELTA. Every interview would end at exactly the
 * 10-turn floor and the quality gates above would never be reached. A mean
 * confidence near zero means the information is absent, not saturated.
 */
export const SATURATION_MIN_CONFIDENCE = 0.25;

export type TerminationReason =
  | "max_turns"
  | "quality_met"
  | "saturated"
  | "user_stopped"
  | null;

export interface TerminationInput {
  turn: number;
  meanConfidence: number;
  overallCoverage: number;
  unresolvedContradictions: number;
  /** Mean confidence at the end of each past turn, oldest first. */
  meanConfidenceHistory: readonly number[];
}

export interface TerminationDecision {
  shouldComplete: boolean;
  reason: TerminationReason;
}

export function evaluateTermination(input: TerminationInput): TerminationDecision {
  if (input.turn >= MAX_TURNS) {
    return { shouldComplete: true, reason: "max_turns" };
  }
  if (input.turn < MIN_TURNS) {
    return { shouldComplete: false, reason: null };
  }

  const qualityMet =
    input.meanConfidence >= CONFIDENCE_TARGET &&
    input.overallCoverage >= COVERAGE_TARGET &&
    input.unresolvedContradictions <= MAX_UNRESOLVED_CONTRADICTIONS;
  if (qualityMet) {
    return { shouldComplete: true, reason: "quality_met" };
  }

  if (
    input.meanConfidence >= SATURATION_MIN_CONFIDENCE &&
    isSaturated(input.meanConfidenceHistory)
  ) {
    return { shouldComplete: true, reason: "saturated" };
  }

  return { shouldComplete: false, reason: null };
}

/** True when mean confidence has grown by < SATURATION_DELTA over the window. */
export function isSaturated(history: readonly number[]): boolean {
  if (history.length < SATURATION_WINDOW + 1) return false;
  const recent = history.slice(-(SATURATION_WINDOW + 1));
  const growth = recent[recent.length - 1] - recent[0];
  return growth < SATURATION_DELTA;
}

/** §29 — "見る" button becomes available after this many turns. */
export const EARLY_EXIT_MIN_TURNS = 5;

export function canExitEarly(turn: number): boolean {
  return turn >= EARLY_EXIT_MIN_TURNS;
}
