import { EVIDENCE_TYPES, type EvidenceDirection, type EvidenceDraft, type EvidenceType } from "@/lib/types/diagnosis";
import type { Persona } from "./persona";
import type { Rng } from "./rng";

/**
 * The measurement model: how a persona's true traits turn into evidence.
 *
 * ## Why this is the *charitable* assumption
 *
 * We model the LLM extractor as **perfect and unbiased**: it never fabricates,
 * never misreads a trait, and its `strength` / `reliability` numbers are honest.
 * An item of evidence about element e points positive with probability
 * θ_e / 100 — exactly the Bernoulli model under which the obvious estimator
 * (share of positive evidence × 100) converges to θ_e.
 *
 * That matters for how the results should be read. Everything measured here is
 * an **upper bound** on the real system's accuracy: whatever error remains is
 * produced by the arithmetic in `src/lib/engine`, not by Claude. A real
 * extractor can only add error on top. So a failure observed here cannot be
 * blamed on the LLM, and cannot be fixed by prompt engineering.
 *
 * `quote` and `context` are synthesised, because `quoteVerifier` runs before the
 * engine and is already covered by the app's own unit tests. Nothing downstream
 * of `applyTurn` reads them.
 */
export interface RespondentConfig {
  /** Evidence items generated per targeted element, per turn. */
  evidencePerElement: number;
  /** Elements a single question touches. Mirrors the app's 6-element cap. */
  elementsPerTurn: number;
  /** Probability an item is directionless (moves confidence, never score). */
  neutralRate: number;
  /** How many distinct evidence types the interview actually elicits. */
  typePoolSize: number;
  strengthMean: number;
  strengthSd: number;
  reliabilityMean: number;
  reliabilitySd: number;
  /**
   * Systematic tilt toward positive evidence, in probability points.
   * 0 = the unbiased ideal. Non-zero models acquiescence: an interviewer that
   * asks flattering questions, or a subject presenting themselves well.
   */
  positiveBias: number;
}

export const IDEAL_RESPONDENT: RespondentConfig = {
  evidencePerElement: 2,
  elementsPerTurn: 3,
  neutralRate: 0.1,
  typePoolSize: 5,
  strengthMean: 0.7,
  strengthSd: 0.15,
  reliabilityMean: 0.75,
  reliabilitySd: 0.12,
  positiveBias: 0,
};

function clamp01(v: number, lo = 0.3, hi = 1): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Draws the direction of one item.
 *
 * P(positive | not neutral) = θ/100. This is the only place the ground truth
 * enters the simulation; everything after it is the app's own code.
 */
function drawDirection(theta: number, cfg: RespondentConfig, rng: Rng): EvidenceDirection {
  if (rng.bernoulli(cfg.neutralRate)) return "neutral";
  const p = Math.max(0, Math.min(1, theta / 100 + cfg.positiveBias));
  return rng.bernoulli(p) ? "positive" : "negative";
}

export function generateTurnEvidence(
  persona: Persona,
  targetElements: readonly string[],
  cfg: RespondentConfig,
  rng: Rng,
  turn: number
): EvidenceDraft[] {
  const typePool = EVIDENCE_TYPES.slice(0, Math.max(1, cfg.typePoolSize)) as readonly EvidenceType[];
  const drafts: EvidenceDraft[] = [];

  for (const elementId of targetElements) {
    const theta = persona.theta.get(elementId) ?? 50;
    for (let i = 0; i < cfg.evidencePerElement; i++) {
      drafts.push({
        element_id: elementId,
        quote: `synthetic-${elementId}-t${turn}-${i}`,
        type: rng.pick(typePool),
        strength: clamp01(rng.normal(cfg.strengthMean, cfg.strengthSd)),
        reliability: clamp01(rng.normal(cfg.reliabilityMean, cfg.reliabilitySd)),
        direction: drawDirection(theta, cfg, rng),
        context: `simulated turn ${turn}`,
      });
    }
  }

  return drafts;
}
