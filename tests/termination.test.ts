import { describe, expect, it } from "vitest";
import {
  evaluateTermination,
  hasEnoughTurnsToRead,
  MAX_TURNS,
  MIN_TURNS_FOR_READING,
} from "@/lib/engine/terminationEngine";
import { computeProgress } from "@/lib/engine/progress";

/**
 * When the interview stops, and when there is enough of it to read.
 *
 * Both quality gates are gone. `quality_met` asked for mean confidence ≥ 0.75
 * and coverage ≥ 0.7, and `saturated` asked whether confidence had stopped
 * climbing; neither number is computed during the interview any more. The
 * 10-turn floor that used to hold `quality_met` off went with them — it guarded
 * a gate that no longer exists, and its number now belongs to the ceiling.
 */

describe("evaluateTermination", () => {
  it("keeps going below the ceiling", () => {
    for (let turn = 1; turn < MAX_TURNS; turn++) {
      expect(evaluateTermination({ turn }).shouldComplete, `turn ${turn}`).toBe(false);
    }
  });

  it("completes at the ceiling", () => {
    const decision = evaluateTermination({ turn: MAX_TURNS });
    expect(decision.shouldComplete).toBe(true);
    expect(decision.reason).toBe("max_turns");
  });

  it("puts the ceiling within reach of a real session", () => {
    // The two live sessions ran 9 and 5 turns before the user left. At 30 the
    // ceiling was unreachable and no session ever completed.
    expect(MAX_TURNS).toBe(10);
  });
});

describe("hasEnoughTurnsToRead", () => {
  it("refuses a session shorter than the floor", () => {
    for (let turn = 0; turn < MIN_TURNS_FOR_READING; turn++) {
      expect(hasEnoughTurnsToRead(turn), `turn ${turn}`).toBe(false);
    }
  });

  it("allows one at the floor and above", () => {
    expect(hasEnoughTurnsToRead(MIN_TURNS_FOR_READING)).toBe(true);
    expect(hasEnoughTurnsToRead(MAX_TURNS)).toBe(true);
  });

  it("leaves room for several topics below the ceiling", () => {
    expect(MIN_TURNS_FOR_READING).toBeLessThan(MAX_TURNS);
  });
});

describe("progress", () => {
  it("is 0 at the start", () => {
    expect(computeProgress({ turn: 0 })).toBe(0);
  });

  it("rises with the turn count alone", () => {
    expect(computeProgress({ turn: 5 })).toBeGreaterThan(computeProgress({ turn: 2 }));
  });

  it("reaches 1 at the ceiling and never exceeds it", () => {
    expect(computeProgress({ turn: MAX_TURNS })).toBe(1);
    expect(computeProgress({ turn: MAX_TURNS + 20 })).toBe(1);
  });
});
