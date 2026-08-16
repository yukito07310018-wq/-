/**
 * Domain types for the diagnosis engine.
 *
 * Everything here is plain data. No LLM types, no Prisma types — the engines in
 * `lib/engine/*` operate purely on these structures so they stay testable.
 */

export const EVIDENCE_TYPES = [
  "explicit_statement",
  "personal_experience",
  "behavioral_example",
  "decision_example",
  "value_statement",
  "counterfactual_answer",
  "reasoning_pattern",
  "emotional_reaction",
  "self_description",
  "contradiction",
  "repeated_pattern",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Total number of evidence types — used as the entropy ceiling in §12. */
export const EVIDENCE_TYPE_COUNT = EVIDENCE_TYPES.length;

export type EvidenceDirection = "positive" | "negative" | "neutral";

export const PROBE_KINDS = [
  "experience",
  "behavior",
  "decision",
  "conflict",
  "failure",
  "hypothetical",
  "relationship",
  "future",
  "value",
] as const;

export type ProbeKind = (typeof PROBE_KINDS)[number];

/**
 * How the next question relates to the topic the user is already on.
 *
 * `opening` and `switch` both start a new topic and are the only two that
 * count as a topic boundary; `deepen` stays where the user already is. The
 * distinction is what keeps the interview honest about who chose the subject.
 */
export const QUESTION_MODES = ["opening", "deepen", "switch"] as const;
export type QuestionMode = (typeof QUESTION_MODES)[number];

/**
 * What the interviewer read in the answer it just received.
 *
 * Only `flat_unknown` — a plain "わからない" with nothing behind it — releases
 * the interview from the current topic early. A user who says they cannot put
 * it into words and then reaches for a metaphor (`metaphor`), or who answers a
 * slightly different question than the one asked (`deflect`), is not empty;
 * both usually mean the question landed near something. Those get another
 * approach at the same place, not a new subject.
 */
export const ANSWER_SIGNALS = ["normal", "flat_unknown", "metaphor", "deflect"] as const;
export type AnswerSignal = (typeof ANSWER_SIGNALS)[number];

export interface ElementDefinition {
  element_id: string;
  name: string;
  definition: string;
  /** ≤60 chars variant used when building prompts (§38). */
  short_definition: string;
  measurement_target: string;
  positive_evidence_examples: string[];
  negative_evidence_examples: string[];
  related_elements: string[];
  contrast_elements: string[];
  axis_id: string;
  weight: number;
}

export interface AxisDefinition {
  axis_id: string;
  name: string;
  description: string;
  element_ids: string[];
}

export interface ScoreHistory {
  turn: number;
  score: number;
  confidence: number;
  delta: number;
  cause_evidence_ids: string[];
}

export interface ElementState {
  element_id: string;
  score: number;
  confidence: number;
  evidence_count: number;
  evidence_diversity: number;
  evidence_type_set: string[];
  last_updated_turn: number;
  history: ScoreHistory[];
}

export interface Evidence {
  evidence_id: string;
  turn_id: number;
  element_id: string;
  quote: string;
  type: EvidenceType;
  strength: number;
  reliability: number;
  direction: EvidenceDirection;
  context: string;
}

/** Evidence as emitted by Call A, before the app assigns an id. */
export type EvidenceDraft = Omit<Evidence, "evidence_id" | "turn_id">;

export interface Contradiction {
  contradiction_id: string;
  elements: string[];
  evidence_a: string;
  evidence_b: string;
  severity: number;
  status: "unresolved" | "resolved";
  detected_turn: number;
  resolution_note?: string;
}

export interface QuestionCandidate {
  question_id: string;
  text: string;
  /**
   * Authored on the pre-written openers only. The interviewer no longer aims a
   * question at elements: one utterance can touch any number of the hundred at
   * once, so "the question for element X" was never a real category. Elements
   * are a reading vocabulary, not a steering wheel.
   */
  target_elements: string[];
  probe_kind: ProbeKind;
  expected_yield: number;
  rationale: string;
}

export interface AskedQuestion {
  turn: number;
  text: string;
  target_elements: string[];
  probe_kind: ProbeKind;
  /** Whether this question started a new topic or stayed on the current one. */
  mode: QuestionMode;
}

export interface AxisAggregate {
  axis_id: string;
  name: string;
  score: number;
  confidence: number;
  coverage: number;
}

export interface ProfileSnapshot {
  elements: Record<string, ElementState>;
  axes: Record<string, AxisAggregate>;
  evidence: Evidence[];
  contradictions: Contradiction[];
  diagnosis_confidence: number;
  coverage: number;
  turn: number;
}

export type DistressLevel = "none" | "distress" | "crisis";

export type ApiErrorCode =
  | "INVALID_INPUT"
  | "SESSION_NOT_FOUND"
  | "SESSION_BUSY"
  | "SESSION_CLOSED"
  | "RATE_LIMITED"
  | "AI_UNAVAILABLE"
  | "INTERNAL";
