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
      const decision = evaluateTermination({ productiveTurns: turn, totalTurns: turn, ...met });
      expect(decision.shouldComplete).toBe(false);
    }
  });

  it("completes once the floor is reached and quality is met", () => {
    const decision = evaluateTermination({ productiveTurns: MIN_TURNS, totalTurns: MIN_TURNS, ...met });
    expect(decision.shouldComplete).toBe(true);
    expect(decision.reason).toBe("quality_met");
  });

  it("does not complete when confidence is short", () => {
    const decision = evaluateTermination({ productiveTurns: 12, totalTurns: 12, ...met, meanConfidence: 0.5 });
    expect(decision.shouldComplete).toBe(false);
  });

  it("does not complete when coverage is short", () => {
    const decision = evaluateTermination({ productiveTurns: 12, totalTurns: 12, ...met, overallCoverage: 0.4 });
    expect(decision.shouldComplete).toBe(false);
  });

  it("does not complete with too many unresolved contradictions", () => {
    const decision = evaluateTermination({ productiveTurns: 12, totalTurns: 12, ...met, unresolvedContradictions: 4 });
    expect(decision.shouldComplete).toBe(false);
  });

  it("force-completes at 30 turns regardless of quality", () => {
    const decision = evaluateTermination({
      productiveTurns: MAX_TURNS,
      totalTurns: MAX_TURNS,
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
      productiveTurns: 14,
      totalTurns: 14,
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
      productiveTurns: 10,
      totalTurns: 10,
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
    expect(computeProgress({ productiveTurns: 0, meanConfidence: 0, overallCoverage: 0 })).toBe(0);
  });

  it("increases monotonically with each component", () => {
    const base = computeProgress({ productiveTurns: 5, meanConfidence: 0.3, overallCoverage: 0.3 });
    expect(computeProgress({ productiveTurns: 9, meanConfidence: 0.3, overallCoverage: 0.3 })).toBeGreaterThan(base);
    expect(computeProgress({ productiveTurns: 5, meanConfidence: 0.6, overallCoverage: 0.3 })).toBeGreaterThan(base);
    expect(computeProgress({ productiveTurns: 5, meanConfidence: 0.3, overallCoverage: 0.6 })).toBeGreaterThan(base);
  });

  it("saturates at 1 and never exceeds it", () => {
    expect(computeProgress({ productiveTurns: 99, meanConfidence: 1, overallCoverage: 1 })).toBe(1);
  });
});

describe("early exit (§29)", () => {
  it("unlocks after 5 turns", () => {
    expect(canExitEarly(4)).toBe(false);
    expect(canExitEarly(5)).toBe(true);
  });
});

/**
 * A turn the analyst read nothing out of has not advanced the model. Counting
 * it would let an interview reach its minimum length, fill its progress bar and
 * finish "complete" on evidence it never gathered.
 */
describe("turns that produced no evidence", () => {
  it("earns no progress", () => {
    const before = computeProgress({
      productiveTurns: 4,
      meanConfidence: 0.2,
      overallCoverage: 0.2,
    });
    // A fifth turn was taken but yielded nothing: productiveTurns stays at 4.
    const after = computeProgress({
      productiveTurns: 4,
      meanConfidence: 0.2,
      overallCoverage: 0.2,
    });
    expect(after).toBe(before);
  });

  it("does not count toward the minimum length", () => {
    // 20 turns taken, only 9 of them productive — still short of the floor.
    const decision = evaluateTermination({
      productiveTurns: MIN_TURNS - 1,
      totalTurns: 20,
      ...met,
    });
    expect(decision.shouldComplete).toBe(false);
  });

  it("still lets the hard ceiling end the interview", () => {
    // Extraction has failed all the way through; the interview must not run on.
    const decision = evaluateTermination({
      productiveTurns: 0,
      totalTurns: MAX_TURNS,
      ...met,
      meanConfidence: 0,
      overallCoverage: 0,
    });
    expect(decision.shouldComplete).toBe(true);
    expect(decision.reason).toBe("max_turns");
  });

  it("reaches the floor on productive turns regardless of how many were taken", () => {
    const decision = evaluateTermination({
      productiveTurns: MIN_TURNS,
      totalTurns: MIN_TURNS + 7,
      ...met,
    });
    expect(decision.shouldComplete).toBe(true);
    expect(decision.reason).toBe("quality_met");
  });
});
