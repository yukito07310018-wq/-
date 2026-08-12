import type { ElementState, Evidence, EvidenceDirection } from "../types/diagnosis";

/**
 * §10 — score estimation. Pure functions only: the LLM never produces a number
 * that lands in the model, it only produces evidence that these formulas consume.
 *
 * ## Why this is a weighted proportion and not an accumulating delta
 *
 * The original rule moved the score by `sign × strength × reliability × 12`,
 * damped by confidence. That delta never read the current score, so nothing
 * pulled the estimate back toward anything: it was a random walk with drift, and
 * the value it drifted to was a function of how many times an element happened
 * to be asked about rather than of how strongly the trait was present.
 *
 * `validation/` measured the consequence — feeding more evidence made the error
 * *worse* (RMSE 15.6 → 27.0 points, with 36% of elements pinned to 0 or 100),
 * which is the opposite of what an estimator does.
 *
 * The score is now the posterior mean of the rate at which evidence points
 * positive, which is the quantity the 0-100 scale was always meant to express:
 *
 *     score = 100 × (Σ wᵢxᵢ + 0.5κ) / (Σ wᵢ + κ)
 *     wᵢ = strengthᵢ × reliabilityᵢ,  xᵢ = 1 positive / 0 negative
 *
 * Three properties follow from the shape of that formula rather than from
 * tuning: it converges on the true rate as evidence accumulates, it is exactly
 * order-invariant because a sum has no sequence, and it cannot run past the
 * evidence to the boundary. The pseudo-count κ holds an unmeasured element at
 * the neutral 50, the same job it does in axis aggregation (§14).
 */

/** Pseudo-count holding an element at 50 until evidence arrives. */
export const SCORE_PSEUDO_COUNT = 2;
/** §9.2 — per-turn intake limits. */
export const MAX_EVIDENCE_PER_TURN = 8;
export const MAX_ELEMENTS_PER_TURN = 6;

export const INITIAL_SCORE = 50;
export const INITIAL_CONFIDENCE = 0;
/** The rate an element sits at before any evidence: neither present nor absent. */
export const NEUTRAL_RATE = 0.5;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function directionSign(direction: EvidenceDirection): -1 | 0 | 1 {
  if (direction === "positive") return 1;
  if (direction === "negative") return -1;
  return 0;
}

/** strength × reliability, i.e. how much this item should count. */
export function evidenceMagnitude(e: Pick<Evidence, "strength" | "reliability">): number {
  return e.strength * e.reliability;
}

/**
 * How much a directionless item counts toward support.
 *
 * §1.1 promises that neutral evidence raises confidence without moving the
 * score. Under a strict Beta model it would do neither — an item with no
 * direction says nothing about the rate, so it cannot narrow the interval around
 * it. Keeping that promise therefore means stepping outside the model on
 * purpose: a neutral answer is treated as partial support, on the grounds that
 * it still shows the element was genuinely probed and engaged with, which is
 * evidence the estimate rests on a real exchange rather than a misread.
 *
 * It is deliberately worth less than a directional item, and it is the one place
 * in this file where a constant encodes a judgement rather than a derivation.
 */
export const NEUTRAL_SUPPORT_WEIGHT = 0.5;

/**
 * The most weight one turn may contribute to one element.
 *
 * Eight items of evidence extracted from a single answer are not eight
 * independent observations — they are one answer, and the items in it are
 * correlated by construction. Treating them as independent would let a long,
 * emphatic answer count for as much as a whole interview, which overstates the
 * information in it.
 *
 * This also does the job the old ±15 per-turn cap did in §9.3: it bounds how far
 * one crafted answer can push an element, and it does so without reintroducing
 * order-dependence, because scaling a turn's weights is applied per turn and the
 * sum of the turns does not care about sequence. The bound is
 *
 *     max score from a single turn = 100 × (0.5κ + W) / (κ + W) = 75
 *
 * so an element can still be moved substantially by one answer, but never to the
 * extremes, and later evidence pointing the other way pulls it back.
 */
export const MAX_TURN_WEIGHT = 2;

export interface PosteriorEstimate {
  /** 0-100, the reported score. */
  score: number;
  /** The underlying rate in 0-1. */
  rate: number;
  /** Σ weights of directional evidence — what the rate is estimated from. */
  effectiveN: number;
  /** Σ weights counting neutral items at NEUTRAL_SUPPORT_WEIGHT. */
  supportN: number;
  /** Posterior standard deviation of the rate; feeds confidence (§11). */
  posteriorSd: number;
}

/** Posterior SD when nothing has been observed. Confidence is measured against it. */
export const PRIOR_SD = Math.sqrt(
  (NEUTRAL_RATE * (1 - NEUTRAL_RATE)) / (SCORE_PSEUDO_COUNT + 1)
);

/**
 * §10 — the estimate for one element, from all of its evidence.
 *
 * Neutral evidence is excluded from the rate: it carries no direction, so it
 * cannot say whether the trait is present. §1.1's promise that neutral evidence
 * leaves the score untouched is therefore structural here rather than a special
 * case — a neutral item simply is not a term in the sum that produces the score.
 */
export function posteriorEstimate(
  evidence: readonly Pick<Evidence, "strength" | "reliability" | "direction" | "turn_id">[]
): PosteriorEstimate {
  const byTurn = new Map<number, Pick<Evidence, "strength" | "reliability" | "direction">[]>();
  for (const e of evidence) {
    const list = byTurn.get(e.turn_id);
    if (list) list.push(e);
    else byTurn.set(e.turn_id, [e]);
  }

  let weightedPositive = NEUTRAL_RATE * SCORE_PSEUDO_COUNT;
  let directionalWeight = 0;
  let neutralWeight = 0;

  for (const turnItems of byTurn.values()) {
    // One turn is one occasion: its items share a single weight budget.
    const raw = turnItems.reduce((sum, e) => sum + evidenceMagnitude(e), 0);
    const scale = raw > MAX_TURN_WEIGHT ? MAX_TURN_WEIGHT / raw : 1;

    for (const e of turnItems) {
      const sign = directionSign(e.direction);
      const w = evidenceMagnitude(e) * scale;
      if (sign === 0) {
        neutralWeight += w;
        continue;
      }
      directionalWeight += w;
      if (sign > 0) weightedPositive += w;
    }
  }

  const rate = weightedPositive / (SCORE_PSEUDO_COUNT + directionalWeight);
  const supportN = directionalWeight + NEUTRAL_SUPPORT_WEIGHT * neutralWeight;

  return {
    score: clamp(rate * 100, 0, 100),
    rate,
    effectiveN: directionalWeight,
    supportN,
    posteriorSd: Math.sqrt((rate * (1 - rate)) / (SCORE_PSEUDO_COUNT + supportN + 1)),
  };
}

/**
 * §9.2 — keeps the strongest evidence when the analyst over-produces.
 * Items are ranked by strength × reliability; the element cap is applied first
 * (an element is kept whole or not at all), then the item cap.
 */
export function applyTurnLimits<T extends Pick<Evidence, "element_id" | "strength" | "reliability">>(
  items: readonly T[]
): T[] {
  const ranked = [...items].sort((a, b) => evidenceMagnitude(b) - evidenceMagnitude(a));

  const allowedElements = new Set<string>();
  for (const item of ranked) {
    if (allowedElements.size >= MAX_ELEMENTS_PER_TURN && !allowedElements.has(item.element_id)) {
      continue;
    }
    allowedElements.add(item.element_id);
  }

  return ranked.filter((i) => allowedElements.has(i.element_id)).slice(0, MAX_EVIDENCE_PER_TURN);
}

export interface ScoreUpdate {
  element_id: string;
  scoreBefore: number;
  scoreAfter: number;
  /** Movement this turn, for ScoreHistory. Reported, never fed back in. */
  delta: number;
  effectiveN: number;
  posteriorSd: number;
  cause_evidence_ids: string[];
}

/**
 * Recomputes the score of every element touched this turn.
 *
 * Note the shape of the recursion: there isn't one. Each element is re-estimated
 * from its complete evidence, so the result cannot depend on the order the turns
 * arrived in, and a correction to earlier evidence cannot leave a residue. The
 * per-turn ±15 cap the old rule needed is gone — it existed to stop a single
 * turn from lurching the score, which a mean over accumulated evidence cannot do
 * by construction, and keeping it would have reintroduced order-dependence.
 */
export function computeScoreUpdates(
  turnEvidence: readonly Evidence[],
  evidenceByElement: ReadonlyMap<string, readonly Evidence[]>,
  states: ReadonlyMap<string, ElementState>
): ScoreUpdate[] {
  const causesByElement = new Map<string, string[]>();
  for (const e of turnEvidence) {
    const list = causesByElement.get(e.element_id);
    if (list) list.push(e.evidence_id);
    else causesByElement.set(e.element_id, [e.evidence_id]);
  }

  const updates: ScoreUpdate[] = [];
  for (const [elementId, cause_evidence_ids] of causesByElement) {
    const scoreBefore = states.get(elementId)?.score ?? INITIAL_SCORE;
    const estimate = posteriorEstimate(evidenceByElement.get(elementId) ?? []);

    updates.push({
      element_id: elementId,
      scoreBefore,
      scoreAfter: estimate.score,
      delta: estimate.score - scoreBefore,
      effectiveN: estimate.effectiveN,
      posteriorSd: estimate.posteriorSd,
      cause_evidence_ids,
    });
  }

  return updates.sort((a, b) => a.element_id.localeCompare(b.element_id));
}
