import { aggregateAxes, diagnosisConfidence, overallCoverage } from "../engine/aggregation";
import { evidenceMagnitude } from "../engine/scoreEngine";
import { AXES } from "../model/axes";
import { getElement } from "../model/elements";
import * as repo from "../db/repository";
import type { AxisAggregate, Contradiction, ElementState, Evidence } from "../types/diagnosis";

/** §25/§31 — read model for the result dashboard. */

export interface AxisInsight extends AxisAggregate {
  description: string;
  /** §31 — top 3 evidence by strength × reliability within this axis. */
  top_evidence: {
    element_id: string;
    element_name: string;
    quote: string;
    context: string;
    direction: string;
    type: string;
    turn: number;
  }[];
  /** Highest-scoring elements that actually have evidence behind them. */
  notable_elements: {
    element_id: string;
    name: string;
    score: number;
    confidence: number;
    evidence_count: number;
  }[];
}

export interface ProfileResponse {
  session_id: string;
  status: string;
  elements: Record<string, ElementState>;
  axes: Record<string, AxisAggregate>;
  axis_insights: AxisInsight[];
  evidence: Evidence[];
  contradictions: Contradiction[];
  diagnosis_confidence: number;
  coverage: number;
  turn: number;
}

export async function buildProfile(sessionId: string): Promise<ProfileResponse | null> {
  const session = await repo.getSession(sessionId);
  if (!session) return null;

  const [states, evidence, contradictions] = await Promise.all([
    repo.loadElementStates(sessionId),
    repo.loadEvidence(sessionId),
    repo.loadContradictions(sessionId),
  ]);

  const axes = aggregateAxes(states);
  const axesById: Record<string, AxisAggregate> = {};
  for (const axis of axes) axesById[axis.axis_id] = axis;

  const elements: Record<string, ElementState> = {};
  for (const [id, state] of states) elements[id] = state;

  return {
    session_id: sessionId,
    status: session.status,
    elements,
    axes: axesById,
    axis_insights: buildAxisInsights(axes, states, evidence),
    evidence,
    contradictions,
    diagnosis_confidence: diagnosisConfidence(states),
    coverage: overallCoverage(axes),
    turn: session.turnCount,
  };
}

function buildAxisInsights(
  axes: readonly AxisAggregate[],
  states: ReadonlyMap<string, ElementState>,
  evidence: readonly Evidence[]
): AxisInsight[] {
  return axes.map((axis) => {
    const definition = AXES.find((a) => a.axis_id === axis.axis_id);
    const memberIds = new Set(definition?.element_ids ?? []);

    const topEvidence = evidence
      .filter((e) => memberIds.has(e.element_id))
      .sort((a, b) => evidenceMagnitude(b) - evidenceMagnitude(a))
      .slice(0, 3)
      .map((e) => ({
        element_id: e.element_id,
        element_name: getElement(e.element_id)?.name ?? e.element_id,
        quote: e.quote,
        context: e.context,
        direction: e.direction,
        type: e.type,
        turn: e.turn_id,
      }));

    const notable = [...memberIds]
      .map((id) => states.get(id))
      .filter((s): s is ElementState => Boolean(s) && (s as ElementState).evidence_count > 0)
      .sort((a, b) => b.confidence - a.confidence || b.score - a.score)
      .slice(0, 4)
      .map((s) => ({
        element_id: s.element_id,
        name: getElement(s.element_id)?.name ?? s.element_id,
        score: s.score,
        confidence: s.confidence,
        evidence_count: s.evidence_count,
      }));

    return {
      ...axis,
      description: definition?.description ?? "",
      top_evidence: topEvidence,
      notable_elements: notable,
    };
  });
}
