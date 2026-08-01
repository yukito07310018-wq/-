import { INITIAL_CONFIDENCE, INITIAL_SCORE } from "@/lib/engine/scoreEngine";
import type { ElementState, Evidence, EvidenceType } from "@/lib/types/diagnosis";

/** Test builders. Kept deterministic — no randomness, no clock. */

export function makeState(overrides: Partial<ElementState> & { element_id: string }): ElementState {
  return {
    score: INITIAL_SCORE,
    confidence: INITIAL_CONFIDENCE,
    evidence_count: 0,
    evidence_diversity: 0,
    evidence_type_set: [],
    last_updated_turn: 0,
    history: [],
    ...overrides,
  };
}

export function stateMap(states: ElementState[]): Map<string, ElementState> {
  return new Map(states.map((s) => [s.element_id, s]));
}

let evidenceCounter = 0;

export function makeEvidence(
  overrides: Partial<Evidence> & { element_id: string }
): Evidence {
  evidenceCounter += 1;
  return {
    evidence_id: `ev-${evidenceCounter}`,
    turn_id: 1,
    quote: "テスト用の引用テキストです",
    type: "personal_experience" as EvidenceType,
    strength: 0.8,
    reliability: 0.8,
    direction: "positive",
    context: "テスト用。",
    ...overrides,
  };
}

/** Builds an all-elements state map with every element at the given values. */
export function uniformStates(
  elementIds: readonly string[],
  values: Partial<ElementState> = {}
): Map<string, ElementState> {
  return stateMap(elementIds.map((id) => makeState({ element_id: id, ...values })));
}
