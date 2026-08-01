import { clamp } from "./scoreEngine";

/** §30.1 — progress blends turn count, mean confidence and coverage. */
export const TARGET_TURNS = 15;

export interface ProgressInput {
  turn: number;
  meanConfidence: number;
  overallCoverage: number;
}

export function computeProgress({ turn, meanConfidence, overallCoverage }: ProgressInput): number {
  const turnTerm = 0.45 * Math.min(1, turn / TARGET_TURNS);
  const confidenceTerm = 0.35 * Math.min(1, meanConfidence / 0.75);
  const coverageTerm = 0.2 * Math.min(1, overallCoverage / 0.7);
  return clamp(turnTerm + confidenceTerm + coverageTerm, 0, 1);
}
