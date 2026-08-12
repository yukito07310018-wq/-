import { clamp, posteriorEstimate, PRIOR_SD } from "./scoreEngine";
import type { Contradiction, Evidence } from "../types/diagnosis";

/**
 * §11 — confidence.
 *
 * Confidence answers "how well is this estimate supported?", never "how high is
 * the trait?".
 *
 * ## Why this is posterior precision now
 *
 * Confidence used to be an accumulator: each item added `0.18 × strength ×
 * reliability × novelty` of asymptotic gain. That number rose with evidence, but
 * it was never connected to how wrong the estimate actually was, so the badge on
 * the result screen promised an accuracy it had no way to know about.
 * `validation/` found the promise did not hold: error was lowest in the 0.2–0.4
 * band and *rose* above it.
 *
 * Confidence is now read off the same posterior the score comes from. The
 * posterior standard deviation is the estimate's own error bar, so
 *
 *     confidence = 1 − sd / sd_prior
 *
 * is 0 before any evidence (sd is exactly the prior sd) and approaches 1 as the
 * estimate tightens. It is calibrated by construction rather than by tuning:
 * whatever the evidence says, sd is the width of the interval it supports.
 *
 * Two of the old rules survive on top of it, because they encode judgements the
 * posterior cannot make on its own:
 *
 *  - §11.2's diversity ceiling. The posterior treats twenty self-descriptions as
 *    twenty observations; a person describing themselves the same way twenty
 *    times is one observation repeated. The ceiling keeps single-type evidence
 *    below 0.40 no matter how much of it there is.
 *  - §11.3's contradiction discount, now bounded — see `CONTRADICTION_CAP`.
 */

/** §11.3 — per-contradiction discount. */
export const CONTRADICTION_PENALTY_SCALE = 0.25;
/**
 * At most this many unresolved contradictions may discount one element.
 *
 * `detectDirectionalContradictions` pairs every positive item against every
 * negative one, so contradictions grow with the *product* of the two counts —
 * `validation/` measured 101 per element at 60 items of evidence. Multiplying
 * 101 discounts together drove confidence to 0.0009 and made the `conf ≥ 0.75`
 * exit condition recede the longer the conversation ran.
 *
 * Capping at the three most severe keeps the signal (a contradicted element is
 * less certain) without letting the count of pairs stand in for the strength of
 * the conflict. The posterior already handles the rest: evidence pointing both
 * ways lands the rate near 0.5, which is exactly where its variance is highest,
 * so mixed evidence lowers confidence on its own.
 */
export const CONTRADICTION_CAP = 3;

/** §11.2 — ceiling as a function of how many distinct evidence types exist. */
export function confidenceCapByTypeCount(typeCount: number): number {
  if (typeCount <= 0) return 0;
  if (typeCount === 1) return 0.4;
  if (typeCount === 2) return 0.65;
  if (typeCount === 3) return 0.85;
  return 1.0;
}

/**
 * §11.3 — discount from the most severe unresolved contradictions.
 *
 * Only `semantic` conflicts count. A `directional` clash is positive and
 * negative evidence on the same element, and the posterior has already priced
 * that in: mixed evidence puts the rate near 0.5, which is exactly where its
 * variance — and therefore the error bar confidence is read from — is largest.
 * Discounting for it again charges the same conflict twice, and because
 * directional pairs grow with the product of the two counts, that second charge
 * was what pinned confidence near zero on any element with a mixed history.
 *
 * Directional contradictions are still detected, stored and shown; they steer
 * question selection (§17's C term) and they are the honest answer to "why is
 * this element uncertain?". They just no longer bill for it twice.
 *
 * Resolved ones are ignored, which is what makes a resolution restore confidence.
 */
export function applyContradictionPenalty(
  confidence: number,
  contradictions: readonly Pick<Contradiction, "severity" | "status" | "kind">[]
): number {
  const worst = contradictions
    .filter((c) => c.status === "unresolved" && c.kind === "semantic")
    .sort((a, b) => b.severity - a.severity)
    .slice(0, CONTRADICTION_CAP);

  let result = confidence;
  for (const c of worst) result *= 1 - CONTRADICTION_PENALTY_SCALE * c.severity;
  return result;
}

/** Confidence implied by an estimate's own error bar, before caps. */
export function precisionConfidence(posteriorSd: number): number {
  return clamp(1 - posteriorSd / PRIOR_SD, 0, 1);
}

export interface ConfidenceResult {
  confidence: number;
  /** Distinct evidence types seen, in first-seen order. */
  typeSetAfter: string[];
  /** The §11.2 ceiling that applied. */
  cap: number;
  /** Confidence before the ceiling and the contradiction discount. */
  raw: number;
}

/**
 * Full §11 pipeline: posterior precision → diversity ceiling → contradiction discount.
 *
 * This is a pure function of the element's *complete* evidence, which removes a
 * whole class of problem the incremental version had. There is no longer an
 * increment to reverse when a contradiction resolves, and no batch-versus-
 * step-by-step discrepancy to keep in sync — recomputation is the only path, so
 * it cannot disagree with itself.
 */
export function computeConfidence(
  evidence: readonly Pick<Evidence, "type" | "strength" | "reliability" | "direction" | "turn_id">[],
  contradictions: readonly Pick<Contradiction, "severity" | "status" | "kind">[]
): ConfidenceResult {
  const typeSetAfter: string[] = [];
  const seen = new Set<string>();
  for (const e of evidence) {
    if (seen.has(e.type)) continue;
    seen.add(e.type);
    typeSetAfter.push(e.type);
  }

  const raw = precisionConfidence(posteriorEstimate(evidence).posteriorSd);
  const cap = confidenceCapByTypeCount(typeSetAfter.length);
  const confidence = applyContradictionPenalty(Math.min(raw, cap), contradictions);

  return { confidence: clamp(confidence, 0, 1), typeSetAfter, cap, raw };
}
