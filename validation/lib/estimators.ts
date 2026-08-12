import { clamp, posteriorEstimate } from "@/lib/engine/scoreEngine";
import type { Evidence } from "@/lib/types/diagnosis";

/**
 * Estimators compared in the study.
 *
 * `legacyRule` is the score update as it stood before the measurement study —
 * an additive walk over evidence, damped by confidence. It is kept as a frozen
 * baseline so the report can show what changed and by how much, and so a future
 * regression back toward drift would be visible rather than silent.
 *
 * It is a self-contained copy on purpose: it no longer tracks anything in
 * `src/`, because what it describes is no longer there.
 */

export interface ScoreParams {
  /** Score points per unit of strength × reliability. */
  scale: number;
  /** Per-element, per-turn cap applied after summing the turn's deltas. */
  maxTurnDelta: number;
  /** Coefficient of the `1 - k·confidence` damping term. */
  dampingCoefficient: number;
  /** Asymptotic confidence gain per unit of evidence. */
  gainScale: number;
  /** Multiplier for an evidence type that has already been seen. */
  repeatNovelty: number;
}

/** The constants as they were shipped before the fix. */
export const LEGACY_PARAMS: ScoreParams = {
  scale: 12,
  maxTurnDelta: 15,
  dampingCoefficient: 0.5,
  gainScale: 0.18,
  repeatNovelty: 0.35,
};

function sign(direction: Evidence["direction"]): number {
  return direction === "positive" ? 1 : direction === "negative" ? -1 : 0;
}

function legacyCapByTypeCount(typeCount: number): number {
  if (typeCount <= 0) return 0;
  if (typeCount === 1) return 0.4;
  if (typeCount === 2) return 0.65;
  if (typeCount === 3) return 0.85;
  return 1.0;
}

export interface ElementEstimate {
  score: number;
  confidence: number;
}

/**
 * The pre-fix rule.
 *
 * Note what the delta does not contain: the current score. Nothing pulled the
 * estimate back toward anything, so this was a random walk with drift rather
 * than a converging estimator — the property E2 measures.
 */
export function legacyRule(
  evidenceByTurn: readonly (readonly Evidence[])[],
  params = LEGACY_PARAMS
): ElementEstimate {
  let score = 50;
  let confidence = 0;
  const seenTypes = new Set<string>();

  for (const turnItems of evidenceByTurn) {
    if (turnItems.length === 0) continue;
    const confidenceBefore = confidence;

    let summed = 0;
    let gainSum = 0;
    for (const e of turnItems) {
      const s = sign(e.direction);
      if (s !== 0) {
        summed +=
          s *
          e.strength *
          e.reliability *
          params.scale *
          (1 - params.dampingCoefficient * confidenceBefore);
      }
      const novelty = seenTypes.has(e.type) ? params.repeatNovelty : 1;
      seenTypes.add(e.type);
      gainSum += params.gainScale * e.strength * e.reliability * novelty;
    }

    score = clamp(score + clamp(summed, -params.maxTurnDelta, params.maxTurnDelta), 0, 100);
    confidence = Math.min(
      confidenceBefore + (1 - confidenceBefore) * gainSum,
      legacyCapByTypeCount(seenTypes.size)
    );
  }

  return { score, confidence };
}

/**
 * The rule now shipped in `src/lib/engine/scoreEngine.ts`.
 *
 * This wrapper exists so experiments can score an evidence stream directly
 * without running a whole interview. `report.spec.ts` pins it against the
 * engine's own `posteriorEstimate`, so it cannot drift into measuring a
 * different formula than the one users get.
 */
export function currentRule(evidenceByTurn: readonly (readonly Evidence[])[]): ElementEstimate {
  const flat = evidenceByTurn.flat();
  const estimate = posteriorEstimate(flat);
  return { score: estimate.score, confidence: 0 };
}

/**
 * The new rule with its pseudo-count exposed, for the sensitivity experiment.
 *
 * κ is the only free constant the posterior rule has. Mirrors
 * `posteriorEstimate` exactly at κ = SCORE_PSEUDO_COUNT, which E7 asserts.
 */
export function posteriorWithPseudoCount(evidence: readonly Evidence[], kappa: number): number {
  let weightedPositive = 0.5 * kappa;
  let weightTotal = kappa;
  for (const e of evidence) {
    const s = sign(e.direction);
    if (s === 0) continue;
    const w = e.strength * e.reliability;
    weightTotal += w;
    if (s > 0) weightedPositive += w;
  }
  return clamp((weightedPositive / weightTotal) * 100, 0, 100);
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
