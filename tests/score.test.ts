import { describe, expect, it } from "vitest";
import {
  computeScoreUpdates,
  INITIAL_SCORE,
  MAX_TURN_WEIGHT,
  posteriorEstimate,
  SCORE_PSEUDO_COUNT,
} from "@/lib/engine/scoreEngine";
import { makeEvidence, makeState, stateMap } from "./helpers";
import type { Evidence } from "@/lib/types/diagnosis";

/** §10 — the score is the posterior mean of the rate at which evidence points positive. */

/**
 * Each item defaults to its own turn, i.e. an independent occasion. Pass an
 * explicit `turn` to put several items in the same answer, which shares one
 * weight budget (§10, MAX_TURN_WEIGHT).
 */
let turnCounter = 0;
function item(direction: Evidence["direction"], strength = 0.8, reliability = 1, turn?: number) {
  return { strength, reliability, direction, turn_id: turn ?? ++turnCounter };
}

describe("posteriorEstimate", () => {
  it("sits at the neutral prior with no evidence", () => {
    expect(posteriorEstimate([]).score).toBe(INITIAL_SCORE);
  });

  it("moves upward on positive evidence and downward on negative", () => {
    expect(posteriorEstimate([item("positive")]).score).toBeGreaterThan(50);
    expect(posteriorEstimate([item("negative")]).score).toBeLessThan(50);
  });

  it("leaves the score untouched on neutral evidence", () => {
    // §1.1 — a directionless item is not a term in the rate at all.
    expect(posteriorEstimate([item("neutral", 1, 1)]).score).toBe(50);
    const mixed = posteriorEstimate([item("positive"), item("neutral", 1, 1)]);
    expect(mixed.score).toBeCloseTo(posteriorEstimate([item("positive")]).score, 10);
  });

  it("still gains support from neutral evidence", () => {
    // …which is what lets confidence rise on it (§11).
    const withNeutral = posteriorEstimate([item("neutral", 1, 1)]);
    expect(withNeutral.supportN).toBeGreaterThan(0);
    expect(withNeutral.posteriorSd).toBeLessThan(posteriorEstimate([]).posteriorSd);
  });

  it("weights an item by strength × reliability", () => {
    const strong = posteriorEstimate([item("positive", 1, 1)]).score;
    const weak = posteriorEstimate([item("positive", 0.2, 0.5)]).score;
    expect(strong).toBeGreaterThan(weak);
    expect(weak).toBeGreaterThan(50);
  });

  it("is exactly order-invariant", () => {
    // The property the previous additive rule could not offer: a sum has no
    // sequence, so the same answers in any order produce the same estimate.
    const evidence = [
      item("positive", 0.9, 0.8),
      item("negative", 0.5, 0.6),
      item("neutral", 0.7, 0.7),
      item("positive", 0.3, 1),
      item("positive", 0.6, 0.4),
    ];
    const forward = posteriorEstimate(evidence);
    const reversed = posteriorEstimate([...evidence].reverse());
    const shuffled = posteriorEstimate([evidence[3], evidence[0], evidence[4], evidence[2], evidence[1]]);

    expect(reversed.score).toBeCloseTo(forward.score, 12);
    expect(shuffled.score).toBeCloseTo(forward.score, 12);
  });

  it("converges on the rate the evidence implies", () => {
    // 70% positive evidence should read ~70, and get closer as evidence grows.
    const build = (n: number) =>
      Array.from({ length: n }, (_, i) => item(i % 10 < 7 ? "positive" : "negative", 1, 1));

    const near = Math.abs(posteriorEstimate(build(20)).score - 70);
    const nearer = Math.abs(posteriorEstimate(build(200)).score - 70);
    expect(nearer).toBeLessThan(near);
    expect(nearer).toBeLessThan(1);
  });

  it("cannot be driven past the evidence to the boundary", () => {
    // 40 unanimous items across 40 turns: the estimate approaches 100 but the
    // pseudo-count keeps it short, so repetition never pins an element to the edge.
    const unanimous = Array.from({ length: 40 }, () => item("positive", 1, 1));
    const score = posteriorEstimate(unanimous).score;
    expect(score).toBeGreaterThan(90);
    expect(score).toBeLessThan(100);
  });

  it("bounds what one answer can contribute", () => {
    // §9.3 — the job the old ±15 per-turn cap did. Twenty maximal items inside a
    // single turn share one weight budget, so they move the element no further
    // than 100 × (0.5κ + W) / (κ + W).
    const oneAnswer = Array.from({ length: 20 }, () => item("positive", 1, 1, 7));
    const bound = (100 * (0.5 * SCORE_PSEUDO_COUNT + MAX_TURN_WEIGHT)) / (SCORE_PSEUDO_COUNT + MAX_TURN_WEIGHT);

    expect(posteriorEstimate(oneAnswer).score).toBeCloseTo(bound, 10);
    // Twice as many items in the same answer buy nothing more.
    const twiceAsMany = Array.from({ length: 40 }, () => item("positive", 1, 1, 8));
    expect(posteriorEstimate(twiceAsMany).score).toBeCloseTo(bound, 10);
  });

  it("still separates a sustained pattern from one emphatic answer", () => {
    const oneAnswer = Array.from({ length: 20 }, () => item("positive", 1, 1, 11));
    const manyAnswers = Array.from({ length: 20 }, () => item("positive", 1, 1));
    expect(posteriorEstimate(manyAnswers).score).toBeGreaterThan(
      posteriorEstimate(oneAnswer).score
    );
  });

  it("tightens the posterior as evidence accumulates", () => {
    const few = posteriorEstimate(Array.from({ length: 3 }, () => item("positive", 1, 1)));
    const many = posteriorEstimate(Array.from({ length: 30 }, () => item("positive", 1, 1)));
    expect(many.posteriorSd).toBeLessThan(few.posteriorSd);
    expect(many.effectiveN).toBeCloseTo(30, 10);
  });

  it("keeps the pseudo-count out of the reported sample size", () => {
    expect(posteriorEstimate([]).effectiveN).toBe(0);
    expect(SCORE_PSEUDO_COUNT).toBeGreaterThan(0);
  });
});

describe("computeScoreUpdates", () => {
  const byElement = (evidence: Evidence[]) => new Map([["E001", evidence]]);

  it("estimates from the element's whole evidence, not just this turn's", () => {
    const prior = [makeEvidence({ element_id: "E001", direction: "positive", turn_id: 1 })];
    const fresh = makeEvidence({ element_id: "E001", direction: "positive", turn_id: 2 });

    const [update] = computeScoreUpdates(
      [fresh],
      byElement([...prior, fresh]),
      stateMap([makeState({ element_id: "E001" })])
    );
    expect(update.scoreAfter).toBeCloseTo(posteriorEstimate([...prior, fresh]).score, 10);
  });

  it("reports the movement as a delta without feeding it back", () => {
    const evidence = [makeEvidence({ element_id: "E001", direction: "positive" })];
    const [update] = computeScoreUpdates(
      evidence,
      byElement(evidence),
      stateMap([makeState({ element_id: "E001", score: 61 })])
    );
    expect(update.scoreBefore).toBe(61);
    expect(update.delta).toBeCloseTo(update.scoreAfter - 61, 10);
    // The estimate depends on the evidence alone; the stale 61 does not survive.
    expect(update.scoreAfter).toBeCloseTo(posteriorEstimate(evidence).score, 10);
  });

  it("leaves the score at the prior when all evidence is neutral", () => {
    const evidence = [makeEvidence({ element_id: "E001", direction: "neutral" })];
    const [update] = computeScoreUpdates(
      evidence,
      byElement(evidence),
      stateMap([makeState({ element_id: "E001" })])
    );
    expect(update.scoreAfter).toBe(50);
  });

  it("moves a well-evidenced element less than a fresh one", () => {
    // Self-damping falls out of the mean: one more item among thirty barely
    // shifts it. The old rule needed an explicit confidence-damping term.
    const history = Array.from({ length: 30 }, (_, i) =>
      makeEvidence({ element_id: "E001", direction: "positive", turn_id: i + 1 })
    );
    const fresh = makeEvidence({ element_id: "E001", direction: "negative", turn_id: 31 });

    const settled = computeScoreUpdates(
      [fresh],
      byElement([...history, fresh]),
      stateMap([makeState({ element_id: "E001", score: posteriorEstimate(history).score })])
    );
    const cold = computeScoreUpdates(
      [fresh],
      byElement([fresh]),
      stateMap([makeState({ element_id: "E001" })])
    );

    expect(Math.abs(settled[0].delta)).toBeLessThan(Math.abs(cold[0].delta));
  });

  it("returns one update per element touched this turn", () => {
    const a = makeEvidence({ element_id: "E001" });
    const b = makeEvidence({ element_id: "E002" });
    const updates = computeScoreUpdates(
      [a, b],
      new Map([
        ["E001", [a]],
        ["E002", [b]],
      ]),
      stateMap([makeState({ element_id: "E001" }), makeState({ element_id: "E002" })])
    );
    expect(updates.map((u) => u.element_id)).toEqual(["E001", "E002"]);
    expect(updates[0].cause_evidence_ids).toEqual([a.evidence_id]);
  });
});
