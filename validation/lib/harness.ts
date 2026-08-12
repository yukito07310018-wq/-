import { applyTurn } from "@/lib/engine/turnUpdate";
import type {
  AxisAggregate,
  Contradiction,
  ElementState,
  Evidence,
  EvidenceDraft,
} from "@/lib/types/diagnosis";
import { ELEMENT_IDS, requireElement } from "@/lib/model/elements";
import { FOCUS_ELEMENT_BUDGET } from "@/lib/ai/prompts";
import type { Persona } from "./persona";
import { generateTurnEvidence, IDEAL_RESPONDENT, type RespondentConfig } from "./respondent";
import { makeRng, type Rng } from "./rng";

/**
 * Runs a full simulated interview through the **production** engine.
 *
 * `applyTurn` is imported from `src/lib/engine`, not reimplemented here. That is
 * deliberate: a validation suite that re-derives the formulas would only be
 * validating its own copy of them, and would silently keep passing after the
 * real engine changed.
 *
 * The two things this harness substitutes for are the two LLM calls — the
 * respondent (Call A's input) and the question selector (Call B). Everything in
 * between is the shipped code path.
 */

export interface TurnSnapshot {
  turn: number;
  meanConfidence: number;
  coverage: number;
  /** score/confidence for every element that has evidence by this turn. */
  measured: { element_id: string; score: number; confidence: number }[];
}

export interface RunResult {
  persona: Persona;
  turns: number;
  states: Map<string, ElementState>;
  evidence: Evidence[];
  contradictions: Contradiction[];
  axes: AxisAggregate[];
  meanConfidence: number;
  coverage: number;
  snapshots: TurnSnapshot[];
}

export interface RunOptions {
  turns: number;
  seed: number;
  respondent?: RespondentConfig;
  /** Overrides the default lowest-confidence-first targeting. */
  selectTargets?: (states: ReadonlyMap<string, ElementState>, turn: number, rng: Rng) => string[];
}

/**
 * Stand-in for `questionSelector`.
 *
 * The real QValue is 0.35·uncertainty + 0.25·information gain + 0.20·contradiction
 * + 0.10·diversity + 0.10·unexplored-importance. Uncertainty and unexplored-importance
 * both push toward low-confidence elements, so "ask about the least-known elements,
 * with some jitter" reproduces where the real selector spends its questions
 * without needing an LLM to write them.
 *
 * It also mirrors `selectContextElements`'s focus budget: the app offers new
 * elements only until FOCUS_ELEMENT_BUDGET of them are open, then deepens. If
 * this stand-in kept sweeping after the app stopped, every number in the study
 * would describe an interview the app no longer runs.
 *
 * The jitter matters: a purely deterministic sweep would visit every element the
 * same number of times, which is a friendlier interview than the real one.
 */
function lowestConfidenceFirst(
  states: ReadonlyMap<string, ElementState>,
  count: number,
  rng: Rng
): string[] {
  const isOpen = (id: string) => (states.get(id)?.evidence_count ?? 0) > 0;
  const openCount = ELEMENT_IDS.filter(isOpen).length;
  const candidates =
    openCount < FOCUS_ELEMENT_BUDGET ? ELEMENT_IDS : ELEMENT_IDS.filter(isOpen);

  const openedPerAxis = new Map<string, number>();
  for (const id of ELEMENT_IDS) {
    if (!isOpen(id)) continue;
    const axisId = requireElement(id).axis_id;
    openedPerAxis.set(axisId, (openedPerAxis.get(axisId) ?? 0) + 1);
  }

  const scored = candidates.map((id) => {
    const s = states.get(id);
    const confidence = s?.confidence ?? 0;
    // Untouched elements from the least-covered axes come first, as in the app.
    const axisLoad = isOpen(id) ? 0 : (openedPerAxis.get(requireElement(id).axis_id) ?? 0) * 0.001;
    return { id, key: confidence + axisLoad + rng.range(0, 0.0005) };
  });
  scored.sort((a, b) => a.key - b.key);
  return scored.slice(0, count).map((s) => s.id);
}

export function runInterview(persona: Persona, options: RunOptions): RunResult {
  const cfg = options.respondent ?? IDEAL_RESPONDENT;
  const rng = makeRng(options.seed);

  let states: Map<string, ElementState> = new Map();
  let evidence: Evidence[] = [];
  let contradictions: Contradiction[] = [];
  let axes: AxisAggregate[] = [];
  let meanConfidence = 0;
  let coverage = 0;
  const snapshots: TurnSnapshot[] = [];

  for (let turn = 1; turn <= options.turns; turn++) {
    const targets = options.selectTargets
      ? options.selectTargets(states, turn, rng)
      : lowestConfidenceFirst(states, cfg.elementsPerTurn, rng);

    const drafts = generateTurnEvidence(persona, targets, cfg, rng, turn);

    const result = applyTurn({
      turn,
      states,
      priorEvidence: evidence,
      priorContradictions: contradictions,
      drafts,
      semanticCandidates: [],
      makeEvidenceId: (index) => `ev-${turn}-${index}`,
      makeContradictionId: (index) => `ct-${turn}-${index}`,
    });

    states = result.states;
    evidence = [...evidence, ...result.newEvidence];
    contradictions = result.contradictions;
    axes = result.axes;
    meanConfidence = result.meanConfidence;
    coverage = result.coverage;

    snapshots.push({
      turn,
      meanConfidence,
      coverage,
      measured: [...states.values()]
        .filter((s) => s.evidence_count > 0)
        .map((s) => ({ element_id: s.element_id, score: s.score, confidence: s.confidence })),
    });
  }

  return {
    persona,
    turns: options.turns,
    states,
    evidence,
    contradictions,
    axes,
    meanConfidence,
    coverage,
    snapshots,
  };
}

/**
 * Replays a fixed sequence of evidence batches through the real engine.
 *
 * Used by the order-invariance test: permuting the batches and replaying gives
 * the same evidence in a different sequence, which is exactly the manipulation a
 * measurement instrument is supposed to be indifferent to.
 */
export function replayTurns(batches: readonly (readonly EvidenceDraft[])[]): {
  states: Map<string, ElementState>;
  contradictions: Contradiction[];
} {
  let states: Map<string, ElementState> = new Map();
  let evidence: Evidence[] = [];
  let contradictions: Contradiction[] = [];

  batches.forEach((drafts, i) => {
    const turn = i + 1;
    const result = applyTurn({
      turn,
      states,
      priorEvidence: evidence,
      priorContradictions: contradictions,
      drafts,
      semanticCandidates: [],
      makeEvidenceId: (index) => `ev-${turn}-${index}`,
      makeContradictionId: (index) => `ct-${turn}-${index}`,
    });
    states = result.states;
    evidence = [...evidence, ...result.newEvidence];
    contradictions = result.contradictions;
  });

  return { states, contradictions };
}

/** Regenerates the evidence batches an interview would produce, without running it. */
export function recordBatches(persona: Persona, options: RunOptions): EvidenceDraft[][] {
  const cfg = options.respondent ?? IDEAL_RESPONDENT;
  const rng = makeRng(options.seed);
  let states: Map<string, ElementState> = new Map();
  let evidence: Evidence[] = [];
  let contradictions: Contradiction[] = [];
  const batches: EvidenceDraft[][] = [];

  for (let turn = 1; turn <= options.turns; turn++) {
    const targets = options.selectTargets
      ? options.selectTargets(states, turn, rng)
      : lowestConfidenceFirst(states, cfg.elementsPerTurn, rng);
    const drafts = generateTurnEvidence(persona, targets, cfg, rng, turn);
    batches.push(drafts);

    const result = applyTurn({
      turn,
      states,
      priorEvidence: evidence,
      priorContradictions: contradictions,
      drafts,
      semanticCandidates: [],
      makeEvidenceId: (index) => `ev-${turn}-${index}`,
      makeContradictionId: (index) => `ct-${turn}-${index}`,
    });
    states = result.states;
    evidence = [...evidence, ...result.newEvidence];
    contradictions = result.contradictions;
  }

  return batches;
}

/** Elements the interview actually reached — the only ones an estimate exists for. */
export function measuredElements(run: RunResult): string[] {
  return [...run.states.values()]
    .filter((s) => s.evidence_count > 0)
    .map((s) => s.element_id)
    .sort();
}

export function scoresOf(run: RunResult, elementIds: readonly string[]): number[] {
  return elementIds.map((id) => run.states.get(id)?.score ?? 50);
}

export function confidencesOf(run: RunResult, elementIds: readonly string[]): number[] {
  return elementIds.map((id) => run.states.get(id)?.confidence ?? 0);
}
