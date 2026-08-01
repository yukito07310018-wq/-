import { AXES } from "../model/axes";
import { getElementWeight } from "../model/elements";
import { clamp, INITIAL_SCORE } from "./scoreEngine";
import type { AxisAggregate, ElementState } from "../types/diagnosis";

/**
 * §14 — aggregation of 100 elements into 10 axes.
 *
 * The naive weighted mean divides by Σ(confidence × weight), which is exactly 0
 * on turn 0. A pseudo-count pulls the estimate toward the neutral prior of 50
 * instead, so an unmeasured axis reads "50, confidence 0" rather than NaN.
 */
export const KAPPA = 0.5;
export const NEUTRAL_PRIOR = INITIAL_SCORE;

function stateOf(states: ReadonlyMap<string, ElementState>, elementId: string) {
  const s = states.get(elementId);
  return {
    score: s?.score ?? NEUTRAL_PRIOR,
    confidence: s?.confidence ?? 0,
    evidenceCount: s?.evidence_count ?? 0,
  };
}

export function axisScore(
  elementIds: readonly string[],
  states: ReadonlyMap<string, ElementState>
): number {
  let numerator = NEUTRAL_PRIOR * KAPPA;
  let denominator = KAPPA;
  for (const id of elementIds) {
    const { score, confidence } = stateOf(states, id);
    const w = getElementWeight(id);
    numerator += score * confidence * w;
    denominator += confidence * w;
  }
  return clamp(numerator / denominator, 0, 100);
}

export function axisConfidence(
  elementIds: readonly string[],
  states: ReadonlyMap<string, ElementState>
): number {
  let weighted = 0;
  let weightSum = 0;
  for (const id of elementIds) {
    const w = getElementWeight(id);
    weighted += stateOf(states, id).confidence * w;
    weightSum += w;
  }
  return weightSum === 0 ? 0 : clamp(weighted / weightSum, 0, 1);
}

export function axisCoverage(
  elementIds: readonly string[],
  states: ReadonlyMap<string, ElementState>
): number {
  if (elementIds.length === 0) return 0;
  const withEvidence = elementIds.filter((id) => stateOf(states, id).evidenceCount >= 1).length;
  return withEvidence / elementIds.length;
}

export function aggregateAxes(states: ReadonlyMap<string, ElementState>): AxisAggregate[] {
  return AXES.map((axis) => ({
    axis_id: axis.axis_id,
    name: axis.name,
    score: axisScore(axis.element_ids, states),
    confidence: axisConfidence(axis.element_ids, states),
    coverage: axisCoverage(axis.element_ids, states),
  }));
}

/** §14.4 — mean of the ten axis coverages. */
export function overallCoverage(axes: readonly AxisAggregate[]): number {
  if (axes.length === 0) return 0;
  return axes.reduce((sum, a) => sum + a.coverage, 0) / axes.length;
}

/** §14.4 — weighted mean confidence across all 100 elements. */
export function diagnosisConfidence(states: ReadonlyMap<string, ElementState>): number {
  let weighted = 0;
  let weightSum = 0;
  for (const axis of AXES) {
    for (const id of axis.element_ids) {
      const w = getElementWeight(id);
      weighted += stateOf(states, id).confidence * w;
      weightSum += w;
    }
  }
  return weightSum === 0 ? 0 : clamp(weighted / weightSum, 0, 1);
}
