/**
 * When the interview stops.
 *
 * Reading happens once, over the whole conversation, so there is no per-turn
 * confidence for a quality gate to read. The interview ends because the user
 * pressed 「ここまでにする」 or because the turn ceiling was reached — nothing
 * else. `quality_met` (confidence ≥ 0.75 + coverage ≥ 0.7) and the saturation
 * rule are both gone, and so is the 10-turn floor that used to hold them off:
 * that floor existed only to stop a talkative user tripping the quality gate
 * early, and with the gate removed it has nothing left to guard.
 */

/**
 * Hard ceiling. Ten, not thirty: the two real sessions ran 9 and 5 turns before
 * the user left, so a ceiling of 30 was never reached and produced nothing. At
 * 10 the first of those sessions would have completed and been read.
 */
export const MAX_TURNS = 10;

/**
 * Below this many turns there is too little conversation to read. Provisional —
 * it is one constant precisely so it can be moved once real sessions say what
 * the floor should be.
 */
export const MIN_TURNS_FOR_READING = 3;

export type TerminationReason = "max_turns" | "user_stopped" | null;

export interface TerminationDecision {
  shouldComplete: boolean;
  reason: TerminationReason;
}

export function evaluateTermination(input: { turn: number }): TerminationDecision {
  if (input.turn >= MAX_TURNS) return { shouldComplete: true, reason: "max_turns" };
  return { shouldComplete: false, reason: null };
}

/** Whether a session has enough turns for the batch reading to be worth running. */
export function hasEnoughTurnsToRead(turnCount: number): boolean {
  return turnCount >= MIN_TURNS_FOR_READING;
}
