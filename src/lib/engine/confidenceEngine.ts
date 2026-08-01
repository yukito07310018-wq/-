import { clamp } from "./scoreEngine";
import type { Contradiction, Evidence } from "../types/diagnosis";

/**
 * §11 — confidence update.
 *
 * Confidence answers "how well is this estimate supported?", never "how high is
 * the trait?". It is deliberately hard to max out: repeating the same *kind* of
 * evidence is capped (§11.2) and unresolved contradictions discount it (§11.3).
 */

export const GAIN_SCALE = 0.18;
export const REPEAT_TYPE_NOVELTY = 0.35;
export const CONTRADICTION_PENALTY_SCALE = 0.25;

/** §11.2 — ceiling as a function of how many distinct evidence types exist. */
export function confidenceCapByTypeCount(typeCount: number): number {
  if (typeCount <= 0) return 0;
  if (typeCount === 1) return 0.4;
  if (typeCount === 2) return 0.65;
  if (typeCount === 3) return 0.85;
  return 1.0;
}

export interface ConfidenceGainResult {
  gainSum: number;
  /** Evidence types known for this element after the turn. */
  typeSetAfter: string[];
}

/**
 * Accumulated gain from a turn's evidence for one element.
 * A type already seen — whether in an earlier turn or earlier in this same turn
 * — only counts at REPEAT_TYPE_NOVELTY.
 */
export function computeConfidenceGain(
  evidence: readonly Pick<Evidence, "type" | "strength" | "reliability">[],
  typeSetBefore: readonly string[]
): ConfidenceGainResult {
  const seen = new Set(typeSetBefore);
  const typeSetAfter = [...typeSetBefore];
  let gainSum = 0;

  for (const e of evidence) {
    const novelty = seen.has(e.type) ? REPEAT_TYPE_NOVELTY : 1.0;
    if (!seen.has(e.type)) {
      seen.add(e.type);
      typeSetAfter.push(e.type);
    }
    gainSum += GAIN_SCALE * e.strength * e.reliability * novelty;
  }

  return { gainSum, typeSetAfter };
}

/** Asymptotic update: confidence never reaches 1 by accumulation alone. */
export function applyConfidenceGain(confidenceBefore: number, gainSum: number): number {
  return confidenceBefore + (1 - confidenceBefore) * gainSum;
}

/**
 * §11.3 — multiplicative discount from every unresolved contradiction the
 * element is involved in.
 */
export function applyContradictionPenalty(
  confidence: number,
  contradictions: readonly Pick<Contradiction, "severity" | "status">[]
): number {
  let result = confidence;
  for (const c of contradictions) {
    if (c.status !== "unresolved") continue;
    result *= 1 - CONTRADICTION_PENALTY_SCALE * c.severity;
  }
  return result;
}

export interface ConfidenceUpdateInput {
  confidenceBefore: number;
  evidenceThisTurn: readonly Pick<Evidence, "type" | "strength" | "reliability">[];
  typeSetBefore: readonly string[];
  /** All contradictions involving this element (resolved ones are ignored). */
  contradictions: readonly Pick<Contradiction, "severity" | "status">[];
}

export interface ConfidenceUpdateResult {
  confidence: number;
  typeSetAfter: string[];
  cap: number;
}

/** Full §11 pipeline: gain → asymptotic update → diversity cap → contradiction penalty. */
export function updateConfidence(input: ConfidenceUpdateInput): ConfidenceUpdateResult {
  const { gainSum, typeSetAfter } = computeConfidenceGain(input.evidenceThisTurn, input.typeSetBefore);
  let confidence = applyConfidenceGain(input.confidenceBefore, gainSum);

  const cap = confidenceCapByTypeCount(typeSetAfter.length);
  confidence = Math.min(confidence, cap);
  confidence = applyContradictionPenalty(confidence, input.contradictions);

  return { confidence: clamp(confidence, 0, 1), typeSetAfter, cap };
}

/**
 * Recomputes confidence for an element from the ground up.
 *
 * Needed because §11.3 penalties must be *removable*: when a contradiction is
 * resolved, replaying the evidence is the only way to get back the confidence
 * it was suppressing.
 *
 * Evidence is replayed turn by turn so the result matches what the incremental
 * path would have produced — the asymptotic update is not associative across
 * batches, so replaying everything at once would drift.
 */
export function recomputeConfidenceFromEvidence(
  evidence: readonly Pick<Evidence, "type" | "strength" | "reliability" | "turn_id">[],
  contradictions: readonly Pick<Contradiction, "severity" | "status">[]
): ConfidenceUpdateResult {
  const turns = [...new Set(evidence.map((e) => e.turn_id))].sort((a, b) => a - b);

  let confidence = 0;
  let typeSet: string[] = [];
  for (const turn of turns) {
    const items = evidence.filter((e) => e.turn_id === turn);
    const { gainSum, typeSetAfter } = computeConfidenceGain(items, typeSet);
    confidence = applyConfidenceGain(confidence, gainSum);
    typeSet = typeSetAfter;
  }

  const cap = confidenceCapByTypeCount(typeSet.length);
  confidence = Math.min(confidence, cap);
  confidence = applyContradictionPenalty(confidence, contradictions);
  return { confidence: clamp(confidence, 0, 1), typeSetAfter: typeSet, cap };
}
