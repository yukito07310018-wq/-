import { INITIAL_CONFIDENCE, INITIAL_SCORE } from "@/lib/engine/scoreEngine";
import { buildTranscript, locateQuote, type Transcript } from "@/lib/validation/transcript";
import type {
  AskedQuestion,
  ElementState,
  Evidence,
  EvidenceType,
  QuestionCandidate,
  QuestionMode,
} from "@/lib/types/diagnosis";

/** Test builders. Kept deterministic — no randomness, no clock. */

export function askedQuestion(overrides: Partial<AskedQuestion> = {}): AskedQuestion {
  return {
    turn: 1,
    text: "過去に聞いた質問",
    target_elements: [],
    probe_kind: "experience",
    mode: "deepen",
    ...overrides,
  };
}

/** A question history written as the sequence of modes that produced it. */
export function asked(modes: readonly QuestionMode[]): AskedQuestion[] {
  return modes.map((mode, i) =>
    askedQuestion({ turn: i, text: `質問${i}（${mode}）`, mode })
  );
}

/** A transcript over the given user utterances, as `buildTranscript` sees them. */
export function userTranscript(...utterances: readonly string[]): Transcript {
  return buildTranscript(
    utterances.map((content, i) => ({
      turnIndex: i + 1,
      role: "user" as const,
      content,
    }))
  );
}

/**
 * Splits drafts into the ones whose quote the user actually said and the ones
 * they did not. The batch reading does this inline in `readerCall`; the tests
 * that exercise the retained scoring engines need the same split standalone.
 */
export function splitByGrounding<T extends { quote: string }>(
  drafts: readonly T[],
  transcript: Transcript
): { accepted: T[]; rejected: T[] } {
  const accepted: T[] = [];
  const rejected: T[] = [];
  for (const draft of drafts) {
    if (locateQuote(draft.quote, transcript).ok) accepted.push(draft);
    else rejected.push(draft);
  }
  return { accepted, rejected };
}

export function candidate(questionId: string, text: string): QuestionCandidate {
  return {
    question_id: questionId,
    text,
    target_elements: [],
    probe_kind: "experience",
    expected_yield: 0.7,
    rationale: "",
  };
}

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
