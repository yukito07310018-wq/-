import {
  aggregateAxes,
  diagnosisConfidence,
  overallCoverage,
} from "./aggregation";
import {
  contradictionsForElement,
  detectDirectionalContradictions,
  detectResolutions,
  unresolvedCount,
  validateSemanticCandidates,
  type ContradictionCandidateInput,
  type ContradictionDraft,
  type ResolutionOutcome,
} from "./contradictionEngine";
import { recomputeConfidenceFromEvidence, updateConfidence } from "./confidenceEngine";
import { evidenceDiversity, evidenceTypeSet } from "./diversityEngine";
import { applyTurnLimits, computeScoreUpdates, INITIAL_CONFIDENCE, INITIAL_SCORE } from "./scoreEngine";
import type {
  AxisAggregate,
  Contradiction,
  ElementState,
  Evidence,
  EvidenceDraft,
} from "../types/diagnosis";

/**
 * The deterministic core of one interview turn (§22 steps 4-10).
 *
 * Everything here is a pure function of (previous state, this turn's evidence).
 * No I/O, no LLM, no clock — which is what makes the whole pipeline testable
 * without mocking anything but the two LLM calls at the edges.
 */

export interface TurnUpdateInput {
  turn: number;
  states: ReadonlyMap<string, ElementState>;
  priorEvidence: readonly Evidence[];
  priorContradictions: readonly Contradiction[];
  /** Quote-verified drafts for this turn. */
  drafts: readonly EvidenceDraft[];
  semanticCandidates: readonly ContradictionCandidateInput[];
  /** Injected so the function stays deterministic in tests. */
  makeEvidenceId: (index: number) => string;
  makeContradictionId: (index: number) => string;
}

export interface TurnUpdateResult {
  newEvidence: Evidence[];
  /** Elements whose state changed this turn, keyed by element id. */
  changedStates: Map<string, ElementState>;
  states: Map<string, ElementState>;
  newContradictions: Contradiction[];
  resolutions: ResolutionOutcome[];
  contradictions: Contradiction[];
  axes: AxisAggregate[];
  meanConfidence: number;
  coverage: number;
  unresolvedContradictions: number;
  droppedByLimits: number;
}

function blankState(elementId: string): ElementState {
  return {
    element_id: elementId,
    score: INITIAL_SCORE,
    confidence: INITIAL_CONFIDENCE,
    evidence_count: 0,
    evidence_diversity: 0,
    evidence_type_set: [],
    last_updated_turn: 0,
    history: [],
  };
}

function toContradiction(draft: ContradictionDraft, id: string): Contradiction {
  return {
    contradiction_id: id,
    elements: draft.elements,
    evidence_a: draft.evidence_a,
    evidence_b: draft.evidence_b,
    severity: draft.severity,
    status: "unresolved",
    detected_turn: draft.detected_turn,
  };
}

export function applyTurn(input: TurnUpdateInput): TurnUpdateResult {
  const { turn, states: priorStates, priorEvidence, priorContradictions } = input;

  // --- 1. intake limits (§9.2) ------------------------------------------------
  const limited = applyTurnLimits(input.drafts);
  const droppedByLimits = input.drafts.length - limited.length;

  console.info(
    `[turnUpdate] evidence processing: received=${input.drafts.length}, ` +
    `afterLimits=${limited.length}, dropped=${droppedByLimits}`
  );
  if (input.drafts.length > 0 && limited.length === 0) {
    console.warn(`[turnUpdate] WARNING: all ${input.drafts.length} evidence items were dropped by limits!`);
  }

  const newEvidence: Evidence[] = limited.map((d, index) => ({
    ...d,
    evidence_id: input.makeEvidenceId(index),
    turn_id: turn,
  }));

  const allEvidence = [...priorEvidence, ...newEvidence];
  const touched = [...new Set(newEvidence.map((e) => e.element_id))];

  // --- 2. score update (§10) --------------------------------------------------
  const scoreUpdates = computeScoreUpdates(newEvidence, priorStates);
  const scoreByElement = new Map(scoreUpdates.map((u) => [u.element_id, u]));

  // --- 3. contradictions (§13) ------------------------------------------------
  // Direction clashes are searched over the element's full history, not just
  // this turn, so a reversal three turns later is still caught.
  const relevantEvidence = allEvidence.filter((e) => touched.includes(e.element_id));
  const directionalDrafts = detectDirectionalContradictions(
    relevantEvidence,
    priorContradictions,
    turn
  );
  const semanticDrafts = validateSemanticCandidates(
    input.semanticCandidates,
    allEvidence,
    [...priorContradictions, ...directionalDrafts.map((d, i) => toContradiction(d, `tmp-${i}`))],
    turn
  );
  const newContradictions = [...directionalDrafts, ...semanticDrafts].map((d, i) =>
    toContradiction(d, input.makeContradictionId(i))
  );

  const resolutions = detectResolutions(priorContradictions, allEvidence);
  const resolvedIds = new Map(resolutions.map((r) => [r.contradiction_id, r.resolution_note]));

  const contradictions: Contradiction[] = [
    ...priorContradictions.map((c) =>
      resolvedIds.has(c.contradiction_id)
        ? { ...c, status: "resolved" as const, resolution_note: resolvedIds.get(c.contradiction_id) }
        : c
    ),
    ...newContradictions,
  ];

  // --- 4. element states (§10-§12) --------------------------------------------
  const states = new Map<string, ElementState>(priorStates);
  const changedStates = new Map<string, ElementState>();

  // Elements needing a confidence recompute: those touched this turn, plus any
  // element whose contradiction status changed (penalty added or lifted, §11.3).
  const contradictionAffected = new Set<string>();
  for (const c of newContradictions) for (const id of c.elements) contradictionAffected.add(id);
  for (const r of resolutions) {
    const c = priorContradictions.find((x) => x.contradiction_id === r.contradiction_id);
    for (const id of c?.elements ?? []) contradictionAffected.add(id);
  }

  for (const elementId of new Set([...touched, ...contradictionAffected])) {
    const before = states.get(elementId) ?? blankState(elementId);
    const turnEvidence = newEvidence.filter((e) => e.element_id === elementId);
    const elementEvidence = allEvidence.filter((e) => e.element_id === elementId);
    const elementContradictions = contradictionsForElement(elementId, contradictions);

    let confidence: number;
    let typeSetAfter: string[];

    const hadResolution = resolutions.some((r) => {
      const c = priorContradictions.find((x) => x.contradiction_id === r.contradiction_id);
      return c?.elements.includes(elementId) ?? false;
    });

    if (hadResolution) {
      // A penalty was lifted; replay from evidence so the suppressed confidence
      // comes back rather than staying permanently discounted.
      const recomputed = recomputeConfidenceFromEvidence(elementEvidence, elementContradictions);
      confidence = recomputed.confidence;
      typeSetAfter = recomputed.typeSetAfter;
    } else {
      const updated = updateConfidence({
        confidenceBefore: before.confidence,
        evidenceThisTurn: turnEvidence,
        typeSetBefore: before.evidence_type_set,
        contradictions: elementContradictions,
      });
      confidence = updated.confidence;
      typeSetAfter = updated.typeSetAfter;
    }

    const scoreUpdate = scoreByElement.get(elementId);
    const score = scoreUpdate ? scoreUpdate.scoreAfter : before.score;
    const delta = scoreUpdate ? scoreUpdate.delta : 0;

    const next: ElementState = {
      element_id: elementId,
      score,
      confidence,
      evidence_count: elementEvidence.length,
      evidence_diversity: evidenceDiversity(elementEvidence),
      evidence_type_set: typeSetAfter.length > 0 ? typeSetAfter : evidenceTypeSet(elementEvidence),
      last_updated_turn: turnEvidence.length > 0 ? turn : before.last_updated_turn,
      history: [
        ...before.history,
        {
          turn,
          score,
          confidence,
          delta,
          cause_evidence_ids: scoreUpdate?.cause_evidence_ids ?? [],
        },
      ],
    };

    states.set(elementId, next);
    changedStates.set(elementId, next);
  }

  // --- 5. aggregation (§14) ---------------------------------------------------
  const axes = aggregateAxes(states);

  return {
    newEvidence,
    changedStates,
    states,
    newContradictions,
    resolutions,
    contradictions,
    axes,
    meanConfidence: diagnosisConfidence(states),
    coverage: overallCoverage(axes),
    unresolvedContradictions: unresolvedCount(contradictions),
    droppedByLimits,
  };
}
