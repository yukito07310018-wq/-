import { primaryAxisOf } from "../model/axes";
import { normalizedWeight } from "../model/elements";
import { maxSimilarity, trigramJaccard } from "./similarity";
import type {
  AskedQuestion,
  Contradiction,
  ElementState,
  QValueBreakdown,
  QuestionCandidate,
} from "../types/diagnosis";

/**
 * §17 — question value.
 *
 * The LLM proposes candidates; this module scores and picks. Keeping selection
 * in code is what makes the interview's behaviour reproducible and testable.
 */

export const W_UNCERTAINTY = 0.35;
export const W_INFORMATION = 0.25;
export const W_CONTRADICTION = 0.2;
export const W_DIVERSITY = 0.1;
export const W_EVIDENCE = 0.1;

/** Candidates more similar than this to any past question are dropped outright. */
export const SIMILARITY_EXCLUSION = 0.75;
export const SIMILARITY_PENALTY_SCALE = 0.8;
/** Diversity looks back over this many asked questions. */
export const DIVERSITY_WINDOW = 3;

export interface SelectionContext {
  states: ReadonlyMap<string, ElementState>;
  contradictions: readonly Contradiction[];
  askedQuestions: readonly AskedQuestion[];
}

function confidenceOf(ctx: SelectionContext, elementId: string): number {
  return ctx.states.get(elementId)?.confidence ?? 0;
}

function evidenceCountOf(ctx: SelectionContext, elementId: string): number {
  return ctx.states.get(elementId)?.evidence_count ?? 0;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** U — how unmeasured the targeted elements are. */
export function uncertaintyTerm(targets: readonly string[], ctx: SelectionContext): number {
  return mean(targets.map((id) => 1 - confidenceOf(ctx, id)));
}

/** I — uncertainty × importance, discounted by how likely a concrete answer is. */
export function informationGainTerm(
  targets: readonly string[],
  expectedYield: number,
  ctx: SelectionContext
): number {
  const base = mean(targets.map((id) => (1 - confidenceOf(ctx, id)) * normalizedWeight(id)));
  return base * expectedYield;
}

/** C — the worst unresolved contradiction this question could help settle. */
export function contradictionTerm(targets: readonly string[], ctx: SelectionContext): number {
  const targetSet = new Set(targets);
  let max = 0;
  for (const c of ctx.contradictions) {
    if (c.status !== "unresolved") continue;
    if (!c.elements.some((id) => targetSet.has(id))) continue;
    if (c.severity > max) max = c.severity;
  }
  return max;
}

/** D — penalises repeating the recent axis or probe kind. */
export function diversityTerm(candidate: QuestionCandidate, ctx: SelectionContext): number {
  const recent = ctx.askedQuestions.slice(-DIVERSITY_WINDOW);
  if (recent.length === 0) return 1;

  const candidateAxis = primaryAxisOf(candidate.target_elements);
  const sameAxis = recent.filter((q) => primaryAxisOf(q.target_elements) === candidateAxis).length;
  const sameKind = recent.filter((q) => q.probe_kind === candidate.probe_kind).length;

  // Denominator is the fixed window, per spec, so an early short history is not
  // penalised as if the window were full.
  const axisPenalty = sameAxis / DIVERSITY_WINDOW;
  const kindPenalty = sameKind / DIVERSITY_WINDOW;
  return Math.max(0, 1 - (0.6 * axisPenalty + 0.4 * kindPenalty));
}

/** E — importance weighted toward elements with no evidence at all yet. */
export function evidenceImportanceTerm(targets: readonly string[], ctx: SelectionContext): number {
  return mean(
    targets.map((id) => normalizedWeight(id) * (evidenceCountOf(ctx, id) === 0 ? 1.0 : 0.4))
  );
}

export function scoreCandidate(
  candidate: QuestionCandidate,
  ctx: SelectionContext
): QValueBreakdown {
  const targets = candidate.target_elements;
  const u = uncertaintyTerm(targets, ctx);
  const i = informationGainTerm(targets, candidate.expected_yield, ctx);
  const c = contradictionTerm(targets, ctx);
  const d = diversityTerm(candidate, ctx);
  const e = evidenceImportanceTerm(targets, ctx);

  const base =
    W_UNCERTAINTY * u + W_INFORMATION * i + W_CONTRADICTION * c + W_DIVERSITY * d + W_EVIDENCE * e;

  const similarity = maxSimilarity(
    candidate.text,
    ctx.askedQuestions.map((q) => q.text)
  );
  const excluded = similarity > SIMILARITY_EXCLUSION;
  const qValue = excluded ? 0 : base * (1 - SIMILARITY_PENALTY_SCALE * similarity);

  return {
    question_id: candidate.question_id,
    uncertainty: u,
    information_gain: i,
    contradiction_relevance: c,
    diversity: d,
    evidence_importance: e,
    similarity_penalty: similarity,
    q_value: qValue,
    excluded,
    exclusion_reason: excluded ? "similar_to_past_question" : undefined,
  };
}

export interface SelectionResult {
  selected: QuestionCandidate | null;
  qValue: number;
  breakdowns: QValueBreakdown[];
}

/**
 * Scores every candidate and returns the best surviving one.
 * `selected` is null when all candidates were excluded as near-duplicates —
 * the caller then retries Call B once, then falls back (§17).
 */
export function selectQuestion(
  candidates: readonly QuestionCandidate[],
  ctx: SelectionContext
): SelectionResult {
  const breakdowns = candidates.map((c) => scoreCandidate(c, ctx));
  const byId = new Map(candidates.map((c) => [c.question_id, c]));

  let best: QValueBreakdown | null = null;
  for (const b of breakdowns) {
    if (b.excluded) continue;
    if (best === null || b.q_value > best.q_value) best = b;
  }

  return {
    selected: best ? byId.get(best.question_id) ?? null : null,
    qValue: best?.q_value ?? 0,
    breakdowns,
  };
}

/** Guards against the same question text being asked twice, whatever the source. */
export function isDuplicateQuestion(text: string, asked: readonly AskedQuestion[]): boolean {
  return asked.some((q) => trigramJaccard(text, q.text) > SIMILARITY_EXCLUSION);
}
