import { evidenceDelta, MAX_TURN_DELTA, SCORE_SCALE, clamp } from "@/lib/engine/scoreEngine";
import { updateConfidence } from "@/lib/engine/confidenceEngine";
import type { Evidence } from "@/lib/types/diagnosis";

/**
 * Estimators compared in the study.
 *
 * Two of the questions we need to answer cannot be answered by calling the
 * engine as-is:
 *
 *  - "how much of the result is driven by the hard-coded constants (12, ±15,
 *    0.18, κ=0.5)?" — the constants are module-level `const`s, so varying them
 *    requires a parameterised copy of the recursion;
 *  - "would a different update rule do better on the same evidence?" — needs a
 *    second estimator fed the identical stream.
 *
 * `currentRule` is that parameterised copy. `fidelity.spec.ts` pins it against
 * the shipped `evidenceDelta`, so if the engine's formula changes and this copy
 * is not updated, the suite fails rather than quietly measuring the wrong thing.
 */

export interface ScoreParams {
  /** `SCORE_SCALE` in scoreEngine.ts. */
  scale: number;
  /** `MAX_TURN_DELTA` in scoreEngine.ts. */
  maxTurnDelta: number;
  /** Coefficient of the `1 - k·confidence` damping term. */
  dampingCoefficient: number;
}

export const CURRENT_PARAMS: ScoreParams = {
  scale: SCORE_SCALE,
  maxTurnDelta: MAX_TURN_DELTA,
  dampingCoefficient: 0.5,
};

function sign(direction: Evidence["direction"]): number {
  return direction === "positive" ? 1 : direction === "negative" ? -1 : 0;
}

/** One item's delta, with the engine's constants exposed as parameters. */
export function parameterisedDelta(
  e: Pick<Evidence, "strength" | "reliability" | "direction">,
  confidenceBefore: number,
  params: ScoreParams
): number {
  const s = sign(e.direction);
  if (s === 0) return 0;
  return s * e.strength * e.reliability * params.scale * (1 - params.dampingCoefficient * confidenceBefore);
}

export interface ElementEstimate {
  score: number;
  confidence: number;
}

/**
 * The app's rule: an additive walk over evidence, damped by confidence.
 *
 * Note what the delta does *not* contain: the current score. Nothing pulls the
 * estimate back toward anything, so this is a random walk with drift, not a
 * converging estimator. That property is what E2 measures.
 */
export function currentRule(evidenceByTurn: readonly (readonly Evidence[])[], params = CURRENT_PARAMS): ElementEstimate {
  let score = 50;
  let confidence = 0;
  let typeSet: string[] = [];

  for (const turnItems of evidenceByTurn) {
    if (turnItems.length === 0) continue;
    const confidenceBefore = confidence;

    let summed = 0;
    for (const e of turnItems) summed += parameterisedDelta(e, confidenceBefore, params);
    score = clamp(score + clamp(summed, -params.maxTurnDelta, params.maxTurnDelta), 0, 100);

    const updated = updateConfidence({
      confidenceBefore,
      evidenceThisTurn: turnItems,
      typeSetBefore: typeSet,
      contradictions: [],
    });
    confidence = updated.confidence;
    typeSet = updated.typeSetAfter;
  }

  return { score, confidence };
}

/**
 * Candidate replacement: a weighted posterior mean (Beta-Binomial).
 *
 * Each directional item is one observation — positive counts as 1, negative as
 * 0 — weighted by strength × reliability. A pseudo-count of `kappa` at 0.5 keeps
 * the estimate at 50 before any evidence arrives, which is the same neutral
 * prior the axis aggregation already uses.
 *
 *     score = 100 · (Σ wᵢxᵢ + 0.5κ) / (Σ wᵢ + κ)
 *
 * Three properties the current rule lacks fall out for free:
 *   1. it converges to the true rate as evidence accumulates (consistency);
 *   2. it is order-invariant — the sum does not care about sequence;
 *   3. confidence has a definition rather than a shape: the posterior standard
 *      deviation shrinks as 1/√n, so it can be *checked* against actual error.
 *
 * This is not wired into the app. It exists so the report can say how much of
 * the measured error is inherent to the task and how much is the update rule's.
 */
export function posteriorRule(
  evidenceByTurn: readonly (readonly Evidence[])[],
  kappa = 2
): ElementEstimate {
  let weightedSuccess = 0.5 * kappa;
  let weightTotal = kappa;

  for (const turnItems of evidenceByTurn) {
    for (const e of turnItems) {
      const s = sign(e.direction);
      if (s === 0) continue;
      const w = e.strength * e.reliability;
      weightedSuccess += w * (s > 0 ? 1 : 0);
      weightTotal += w;
    }
  }

  const p = weightedSuccess / weightTotal;
  // Posterior SD of a Beta(α,β) with α+β = weightTotal, mapped to the 0-100 scale.
  const posteriorSd = Math.sqrt((p * (1 - p)) / (weightTotal + 1));
  // Max SD is 0.5 (p=0.5, no data); confidence is how far below that we are.
  const confidence = clamp(1 - posteriorSd / 0.5, 0, 1);

  return { score: clamp(p * 100, 0, 100), confidence };
}

/** Groups an element's evidence into per-turn batches, ordered by turn. */
export function groupByTurn(evidence: readonly Evidence[]): Evidence[][] {
  const byTurn = new Map<number, Evidence[]>();
  for (const e of evidence) {
    const list = byTurn.get(e.turn_id);
    if (list) list.push(e);
    else byTurn.set(e.turn_id, [e]);
  }
  return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([, items]) => items);
}

/** Guards the replica against drift from the shipped formula. */
export function replicaMatchesEngine(
  e: Pick<Evidence, "strength" | "reliability" | "direction">,
  confidenceBefore: number
): boolean {
  const mine = parameterisedDelta(e, confidenceBefore, CURRENT_PARAMS);
  const theirs = evidenceDelta(e, confidenceBefore);
  return Math.abs(mine - theirs) < 1e-12;
}
