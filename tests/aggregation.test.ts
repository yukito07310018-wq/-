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
  it("averages confidence across the measured elements", () => {
    const states = stateMap(
      AX01.map((id) => makeState({ element_id: id, confidence: 0.6, evidence_count: 1 }))
    );
    expect(axisConfidence(AX01, states)).toBeCloseTo(0.6, 10);
  });

  it("leaves unmeasured elements out of the denominator", () => {
    // Three elements measured at 0.6, seven never asked about. The answer is
    // "what we measured, we know to 0.6", not "0.18" — how little was measured
    // is coverage's job to say.
    const states = stateMap([
      ...AX01.slice(0, 3).map((id) =>
        makeState({ element_id: id, confidence: 0.6, evidence_count: 2 })
      ),
      ...AX01.slice(3).map((id) => makeState({ element_id: id, confidence: 0 })),
    ]);
    expect(axisConfidence(AX01, states)).toBeCloseTo(0.6, 10);
    expect(axisCoverage(AX01, states)).toBeCloseTo(0.3, 10);
  });

  it("is 0 while nothing in the axis has been measured", () => {
    const states = stateMap(AX01.map((id) => makeState({ element_id: id })));
    expect(axisConfidence(AX01, states)).toBe(0);
  });

  it("does not let an unmeasured element dilute a measured one", () => {
    const oneMeasured = stateMap([
      makeState({ element_id: AX01[0], confidence: 0.8, evidence_count: 3 }),
      ...AX01.slice(1).map((id) => makeState({ element_id: id })),
    ]);
    const allMeasured = stateMap(
      AX01.map((id) => makeState({ element_id: id, confidence: 0.8, evidence_count: 3 }))
    );
    // Coverage separates these two situations; confidence no longer conflates them.
    expect(axisConfidence(AX01, oneMeasured)).toBeCloseTo(0.8, 10);
    expect(axisConfidence(AX01, allMeasured)).toBeCloseTo(0.8, 10);
    expect(axisCoverage(AX01, oneMeasured)).toBeCloseTo(0.1, 10);
    expect(axisCoverage(AX01, allMeasured)).toBeCloseTo(1, 10);
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
  it("spans every measured element, whichever axis it sits in", () => {
    const mixed = stateMap(
      ELEMENT_IDS.map((id, i) =>
        makeState({ element_id: id, confidence: i < 50 ? 1 : 0.2, evidence_count: 1 })
      )
    );
    const value = diagnosisConfidence(mixed);
    expect(value).toBeGreaterThan(0.5);
    expect(value).toBeLessThan(0.7);
  });

  it("uses the same denominator rule as axisConfidence", () => {
    // Fifty elements measured at 1.0, fifty never touched: 1.0, not 0.5. The
    // §33 gate pairs this with overallCoverage ≥ 0.7, which is what notices
    // that half the model is missing.
    const half = stateMap(
      ELEMENT_IDS.map((id, i) =>
        makeState({ element_id: id, confidence: i < 50 ? 1 : 0, evidence_count: i < 50 ? 1 : 0 })
      )
    );
    expect(diagnosisConfidence(half)).toBeCloseTo(1, 10);
    expect(overallCoverage(aggregateAxes(half))).toBeCloseTo(0.5, 10);
  });

  it("is 0 before anything is measured", () => {
    expect(diagnosisConfidence(uniformStates(ELEMENT_IDS))).toBe(0);
  });
});
