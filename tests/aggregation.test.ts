import { describe, expect, it } from "vitest";
import {
  aggregateAxes,
  axisConfidence,
  axisCoverage,
  axisScore,
  diagnosisConfidence,
  overallCoverage,
} from "@/lib/engine/aggregation";
import { AXES } from "@/lib/model/axes";
import { ELEMENT_IDS } from "@/lib/model/elements";
import { makeState, stateMap, uniformStates } from "./helpers";

/** §14 — 100 elements → 10 axes, including the turn-0 zero-division case. */

const AX01 = AXES[0].element_ids;

describe("turn 0", () => {
  it("returns 50 for every axis instead of NaN when all confidence is 0", () => {
    const states = uniformStates(ELEMENT_IDS);
    const axes = aggregateAxes(states);

    expect(axes).toHaveLength(10);
    for (const axis of axes) {
      expect(Number.isNaN(axis.score)).toBe(false);
      expect(axis.score).toBeCloseTo(50, 10);
      expect(axis.confidence).toBe(0);
      expect(axis.coverage).toBe(0);
    }
  });

  it("does not produce NaN with a completely empty state map", () => {
    const axes = aggregateAxes(new Map());
    for (const axis of axes) {
      expect(Number.isNaN(axis.score)).toBe(false);
      expect(axis.score).toBeCloseTo(50, 10);
    }
    expect(Number.isNaN(diagnosisConfidence(new Map()))).toBe(false);
    expect(Number.isNaN(overallCoverage(axes))).toBe(false);
  });
});

describe("axisScore", () => {
  it("moves toward measured values as confidence rises", () => {
    const weak = stateMap(AX01.map((id) => makeState({ element_id: id, score: 90, confidence: 0.05 })));
    const strong = stateMap(AX01.map((id) => makeState({ element_id: id, score: 90, confidence: 0.95 })));

    const weakScore = axisScore(AX01, weak);
    const strongScore = axisScore(AX01, strong);

    expect(weakScore).toBeGreaterThan(50);
    expect(weakScore).toBeLessThan(strongScore);
    expect(strongScore).toBeGreaterThan(85);
    expect(strongScore).toBeLessThanOrEqual(90);
  });

  it("ignores elements with no confidence when others are measured", () => {
    const states = stateMap([
      makeState({ element_id: AX01[0], score: 90, confidence: 0.9 }),
      ...AX01.slice(1).map((id) => makeState({ element_id: id, score: 10, confidence: 0 })),
    ]);
    expect(axisScore(AX01, states)).toBeGreaterThan(70);
  });

  it("stays inside 0-100", () => {
    const states = stateMap(AX01.map((id) => makeState({ element_id: id, score: 100, confidence: 1 })));
    const score = axisScore(AX01, states);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe("axisConfidence / coverage", () => {
  it("averages confidence across the axis", () => {
    const states = stateMap(AX01.map((id) => makeState({ element_id: id, confidence: 0.6 })));
    expect(axisConfidence(AX01, states)).toBeCloseTo(0.6, 10);
  });

  it("counts elements with at least one piece of evidence", () => {
    const states = stateMap([
      ...AX01.slice(0, 3).map((id) => makeState({ element_id: id, evidence_count: 2 })),
      ...AX01.slice(3).map((id) => makeState({ element_id: id, evidence_count: 0 })),
    ]);
    expect(axisCoverage(AX01, states)).toBeCloseTo(0.3, 10);
  });

  it("averages coverage over the ten axes", () => {
    const states = uniformStates(ELEMENT_IDS, { evidence_count: 1 });
    expect(overallCoverage(aggregateAxes(states))).toBeCloseTo(1, 10);
  });
});

describe("diagnosisConfidence", () => {
  it("spans all 100 elements", () => {
    const half = stateMap(
      ELEMENT_IDS.map((id, i) => makeState({ element_id: id, confidence: i < 50 ? 1 : 0 }))
    );
    const value = diagnosisConfidence(half);
    expect(value).toBeGreaterThan(0.4);
    expect(value).toBeLessThan(0.6);
  });
});
