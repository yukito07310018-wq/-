import { neighbourhoodOf } from "../model/elements";
import { evidenceMagnitude } from "./scoreEngine";
import type { Contradiction, Evidence } from "../types/diagnosis";

/**
 * §13 — contradiction detection.
 *
 * Contradictions are information, not noise: both sides are always kept. The
 * LLM may *point at* a semantic conflict, but only this module decides whether
 * one is recorded and how severe it is.
 */

/** Both sides must be at least this strong before a direction clash counts. */
export const MIN_MAGNITUDE = 0.5;
/** Same-turn clashes are usually "on the one hand / on the other hand". */
export const SAME_TURN_DISCOUNT = 0.5;
/** §13.3 — evidence at or above this reliability can resolve a contradiction. */
export const RESOLUTION_RELIABILITY = 0.7;
export const RESOLUTION_MIN_COUNT = 2;

export interface ContradictionDraft {
  elements: string[];
  evidence_a: string;
  evidence_b: string;
  severity: number;
  detected_turn: number;
}

export interface ContradictionCandidateInput {
  evidence_a: string;
  evidence_b: string;
  note?: string;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function existingPairs(existing: readonly Contradiction[]): Set<string> {
  return new Set(existing.map((c) => pairKey(c.evidence_a, c.evidence_b)));
}

export function computeDirectionalSeverity(
  a: Pick<Evidence, "strength" | "reliability" | "turn_id">,
  b: Pick<Evidence, "strength" | "reliability" | "turn_id">
): number {
  const base = Math.min(1, (evidenceMagnitude(a) + evidenceMagnitude(b)) / 2 + 0.2);
  return a.turn_id === b.turn_id ? base * SAME_TURN_DISCOUNT : base;
}

/**
 * §13.2(a) — within one element, positive vs negative evidence where both sides
 * are strong enough to be taken seriously.
 */
export function detectDirectionalContradictions(
  evidence: readonly Evidence[],
  existing: readonly Contradiction[],
  currentTurn: number
): ContradictionDraft[] {
  const seen = existingPairs(existing);
  const drafts: ContradictionDraft[] = [];

  const byElement = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (e.direction === "neutral") continue;
    if (evidenceMagnitude(e) < MIN_MAGNITUDE) continue;
    const list = byElement.get(e.element_id);
    if (list) list.push(e);
    else byElement.set(e.element_id, [e]);
  }

  for (const [elementId, items] of byElement) {
    const positives = items.filter((e) => e.direction === "positive");
    const negatives = items.filter((e) => e.direction === "negative");
    for (const p of positives) {
      for (const n of negatives) {
        const key = pairKey(p.evidence_id, n.evidence_id);
        if (seen.has(key)) continue;
        seen.add(key);
        drafts.push({
          elements: [elementId],
          evidence_a: p.evidence_id,
          evidence_b: n.evidence_id,
          severity: computeDirectionalSeverity(p, n),
          detected_turn: currentTurn,
        });
      }
    }
  }

  return drafts;
}

/**
 * §13.2(b) — semantic conflicts across two different elements. The LLM supplies
 * candidates; every one is checked here: both evidence ids must exist, the two
 * elements must be declared related/contrasting, and the pair must be new.
 * Anything else is discarded.
 */
export function validateSemanticCandidates(
  candidates: readonly ContradictionCandidateInput[],
  allEvidence: readonly Evidence[],
  existing: readonly Contradiction[],
  currentTurn: number
): ContradictionDraft[] {
  const byId = new Map(allEvidence.map((e) => [e.evidence_id, e]));
  const seen = existingPairs(existing);
  const drafts: ContradictionDraft[] = [];

  for (const candidate of candidates) {
    const a = byId.get(candidate.evidence_a);
    const b = byId.get(candidate.evidence_b);
    if (!a || !b) continue;
    if (a.evidence_id === b.evidence_id) continue;
    if (a.element_id === b.element_id) continue; // handled by the directional rule

    const relatedAB = neighbourhoodOf(a.element_id).has(b.element_id);
    const relatedBA = neighbourhoodOf(b.element_id).has(a.element_id);
    if (!relatedAB && !relatedBA) continue;

    const key = pairKey(a.evidence_id, b.evidence_id);
    if (seen.has(key)) continue;
    seen.add(key);

    drafts.push({
      elements: [a.element_id, b.element_id],
      evidence_a: a.evidence_id,
      evidence_b: b.evidence_id,
      severity: computeDirectionalSeverity(a, b),
      detected_turn: currentTurn,
    });
  }

  return drafts;
}

export function contradictionsForElement(
  elementId: string,
  contradictions: readonly Contradiction[]
): Contradiction[] {
  return contradictions.filter((c) => c.elements.includes(elementId));
}

export function unresolvedCount(contradictions: readonly Contradiction[]): number {
  return contradictions.filter((c) => c.status === "unresolved").length;
}

export interface ResolutionOutcome {
  contradiction_id: string;
  resolution_note: string;
}

/**
 * §13.3 — a contradiction resolves once later turns supply at least two
 * high-reliability items that agree on a direction for the involved elements.
 */
export function detectResolutions(
  contradictions: readonly Contradiction[],
  allEvidence: readonly Evidence[]
): ResolutionOutcome[] {
  const byId = new Map(allEvidence.map((e) => [e.evidence_id, e]));
  const outcomes: ResolutionOutcome[] = [];

  for (const c of contradictions) {
    if (c.status !== "unresolved") continue;

    const later = allEvidence.filter(
      (e) =>
        c.elements.includes(e.element_id) &&
        e.turn_id > c.detected_turn &&
        e.reliability >= RESOLUTION_RELIABILITY &&
        e.direction !== "neutral" &&
        e.evidence_id !== c.evidence_a &&
        e.evidence_id !== c.evidence_b
    );
    if (later.length < RESOLUTION_MIN_COUNT) continue;

    const directions = new Set(later.map((e) => e.direction));
    if (directions.size !== 1) continue;

    const direction = later[0].direction === "positive" ? "その傾向を支持する" : "その傾向を否定する";
    const a = byId.get(c.evidence_a);
    const b = byId.get(c.evidence_b);
    outcomes.push({
      contradiction_id: c.contradiction_id,
      resolution_note:
        `turn ${c.detected_turn} の対立（${a?.direction ?? "?"} / ${b?.direction ?? "?"}）に対し、` +
        `以降のターンで${direction}信頼度の高い証拠が${later.length}件そろったため解消と判定。`,
    });
  }

  return outcomes;
}
