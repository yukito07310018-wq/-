import type { ElementState, Evidence, EvidenceDirection } from "../types/diagnosis";

/**
 * §10 — score update. Pure functions only: the LLM never produces a number that
 * lands in the model, it only produces evidence that these formulas consume.
 */

/** Score points per unit of magnitude for a single evidence item. */
export const SCORE_SCALE = 12;
/** Per-element, per-turn cap applied after summing the turn's deltas. */
export const MAX_TURN_DELTA = 15;
/** §9.2 — per-turn intake limits. */
export const MAX_EVIDENCE_PER_TURN = 8;
export const MAX_ELEMENTS_PER_TURN = 6;

export const INITIAL_SCORE = 50;
export const INITIAL_CONFIDENCE = 0;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function directionSign(direction: EvidenceDirection): -1 | 0 | 1 {
  if (direction === "positive") return 1;
  if (direction === "negative") return -1;
  return 0;
}

/** strength × reliability, i.e. how much this item should move things. */
export function evidenceMagnitude(e: Pick<Evidence, "strength" | "reliability">): number {
  return e.strength * e.reliability;
}

/**
 * Delta contributed by one evidence item, before the per-turn sum is capped.
 * `confidenceBefore` is the element's confidence at the *start* of the turn, so
 * every item in a turn is damped equally (order-independent, hence testable).
 */
export function evidenceDelta(
  e: Pick<Evidence, "strength" | "reliability" | "direction">,
  confidenceBefore: number
): number {
  const sign = directionSign(e.direction);
  if (sign === 0) return 0;
  const magnitude = evidenceMagnitude(e);
  const raw = sign * magnitude * SCORE_SCALE;
  const damping = 1 - 0.5 * confidenceBefore;
  return raw * damping;
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
  /** Total applied delta after the ±15 cap and 0-100 clamp. */
  delta: number;
  cause_evidence_ids: string[];
}

/**
 * Computes the new score for every element touched this turn.
 * Deltas for the same element are summed, capped at ±MAX_TURN_DELTA, then
 * clamped into 0-100.
 */
export function computeScoreUpdates(
  evidence: readonly Evidence[],
  states: ReadonlyMap<string, ElementState>
): ScoreUpdate[] {
  const byElement = new Map<string, Evidence[]>();
  for (const e of evidence) {
    const list = byElement.get(e.element_id);
    if (list) list.push(e);
    else byElement.set(e.element_id, [e]);
  }

  const updates: ScoreUpdate[] = [];
  for (const [elementId, items] of byElement) {
    const state = states.get(elementId);
    const scoreBefore = state?.score ?? INITIAL_SCORE;
    const confidenceBefore = state?.confidence ?? INITIAL_CONFIDENCE;

    let summed = 0;
    for (const item of items) summed += evidenceDelta(item, confidenceBefore);

    const capped = clamp(summed, -MAX_TURN_DELTA, MAX_TURN_DELTA);
    const scoreAfter = clamp(scoreBefore + capped, 0, 100);

    updates.push({
      element_id: elementId,
      scoreBefore,
      scoreAfter,
      delta: scoreAfter - scoreBefore,
      cause_evidence_ids: items.map((i) => i.evidence_id),
    });
  }

  return updates.sort((a, b) => a.element_id.localeCompare(b.element_id));
}
