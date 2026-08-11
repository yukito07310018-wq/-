import { clamp } from "./scoreEngine";

/** §30.1 — progress blends turn count, mean confidence and coverage. */
export const TARGET_TURNS = 15;

export interface ProgressInput {
  /**
   * Turns that actually produced evidence, not turns taken. A turn the analyst
   * could read nothing out of has not advanced the model, and showing the bar
   * move for it tells the user progress was made when none was.
   */
  productiveTurns: number;
  meanConfidence: number;
  overallCoverage: number;
}

export function computeProgress({
  productiveTurns,
  meanConfidence,
  overallCoverage,
}: ProgressInput): number {
  const turnTerm = 0.45 * Math.min(1, productiveTurns / TARGET_TURNS);
  const confidenceTerm = 0.35 * Math.min(1, meanConfidence / 0.75);
  const coverageTerm = 0.2 * Math.min(1, overallCoverage / 0.7);
  return clamp(turnTerm + confidenceTerm + coverageTerm, 0, 1);
}
