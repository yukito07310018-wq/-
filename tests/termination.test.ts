import { describe, expect, it } from "vitest";
import {
  canExitEarly,
  evaluateTermination,
  isSaturated,
  MAX_TURNS,
  MIN_TURNS,
} from "@/lib/engine/terminationEngine";
import { computeProgress } from "@/lib/engine/progress";

/** §33 — floors, ceilings and saturation. */

const met = {
  meanConfidence: 0.8,
  overallCoverage: 0.75,
  unresolvedContradictions: 1,
  meanConfidenceHistory: [] as number[],
};

describe("evaluateTermination", () => {
  it("keeps going below the 10-turn floor even when quality targets are met", () => {
    for (let turn = 1; turn < MIN_TURNS; turn++) {
      const decision = evaluateTermination({ turn, ...met });
      expect(decision.shouldComplete).toBe(false);
    }
  });

  it("completes once the floor is reached and quality is met", () => {
    const decision = evaluateTermination({ turn: MIN_TURNS, ...met });
    expect(decision.shouldComplete).toBe(true);
    expect(decision.reason).toBe("quality_met");
  });

  it("does not complete when confidence is short", () => {
    const decision = evaluateTermination({ turn: 12, ...met, meanConfidence: 0.5 });
    expect(decision.shouldComplete).toBe(false);
  });

  it("does not complete when coverage is short", () => {
    const decision = evaluateTermination({ turn: 12, ...met, overallCoverage: 0.4 });
    expect(decision.shouldComplete).toBe(false);
  });

  it("does not complete with too many unresolved contradictions", () => {
    const decision = evaluateTermination({ turn: 12, ...met, unresolvedContradictions: 4 });
    expect(decision.shouldComplete).toBe(false);
  });

  it("force-completes at 30 turns regardless of quality", () => {
    const decision = evaluateTermination({
      turn: MAX_TURNS,
      meanConfidence: 0.1,
      overallCoverage: 0.1,
      unresolvedContradictions: 12,
      meanConfidenceHistory: [],
    });
    expect(decision.shouldComplete).toBe(true);
    expect(decision.reason).toBe("max_turns");
  });

  it("completes on saturation past the floor", () => {
    const decision = evaluateTermination({
      turn: 14,
      meanConfidence: 0.5,
      overallCoverage: 0.4,
      unresolvedContradictions: 0,
      meanConfidenceHistory: [0.495, 0.497, 0.498, 0.499],
    });
    expect(decision.shouldComplete).toBe(true);
    expect(decision.reason).toBe("saturated");
  });

  it("does not call a barely-started model saturated", () => {
    // Mean confidence rises ~0.002/turn early on, which is under SATURATION_DELTA
    // for reasons that have nothing to do with running out of information.
    const decision = evaluateTermination({
      turn: 10,
      meanConfidence: 0.02,
      overallCoverage: 0.08,
      unresolvedContradictions: 4,
      meanConfidenceHistory: [0.014, 0.016, 0.018, 0.02],
    });
    expect(decision.shouldComplete).toBe(false);
  });
});

describe("isSaturated", () => {
  it("needs a full window before it can trigger", () => {
    expect(isSaturated([0.4, 0.4])).toBe(false);
  });

  it("is false while confidence is still climbing", () => {
    expect(isSaturated([0.2, 0.3, 0.45, 0.6])).toBe(false);
  });

  it("is true when growth over the window is under 0.01", () => {
    expect(isSaturated([0.6, 0.601, 0.602, 0.6035])).toBe(true);
  });
});

describe("progress (§30.1)", () => {
  it("is 0 at the start", () => {
    expect(computeProgress({ turn: 0, meanConfidence: 0, overallCoverage: 0 })).toBe(0);
  });

  it("increases monotonically with each component", () => {
    const base = computeProgress({ turn: 5, meanConfidence: 0.3, overallCoverage: 0.3 });
    expect(computeProgress({ turn: 9, meanConfidence: 0.3, overallCoverage: 0.3 })).toBeGreaterThan(base);
    expect(computeProgress({ turn: 5, meanConfidence: 0.6, overallCoverage: 0.3 })).toBeGreaterThan(base);
    expect(computeProgress({ turn: 5, meanConfidence: 0.3, overallCoverage: 0.6 })).toBeGreaterThan(base);
  });

  it("saturates at 1 and never exceeds it", () => {
    expect(computeProgress({ turn: 99, meanConfidence: 1, overallCoverage: 1 })).toBe(1);
  });
});

describe("early exit (§29)", () => {
  it("unlocks after 5 turns", () => {
    expect(canExitEarly(4)).toBe(false);
    expect(canExitEarly(5)).toBe(true);
  });
});
