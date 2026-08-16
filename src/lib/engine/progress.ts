import { clamp } from "./scoreEngine";
import { MAX_TURNS } from "./terminationEngine";

/**
 * Interview progress.
 *
 * Turn count is now the whole of it. The old formula blended mean confidence
 * and coverage, both of which were per-turn extraction outputs; with the
 * extraction moved to the end of the session there is nothing to blend, and a
 * bar driven by numbers that stay at zero only ever showed 45% of itself.
 */
export function computeProgress({ turn }: { turn: number }): number {
  return clamp(turn / MAX_TURNS, 0, 1);
}
