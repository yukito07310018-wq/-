import { describe, expect, it } from "vitest";
import {
  computeScoreUpdates,
  evidenceDelta,
  MAX_TURN_DELTA,
  SCORE_SCALE,
} from "@/lib/engine/scoreEngine";
import { makeEvidence, makeState, stateMap } from "./helpers";

/** §10 — score movement. */

describe("evidenceDelta", () => {
  it("moves upward on positive evidence", () => {
    expect(evidenceDelta({ strength: 0.8, reliability: 1, direction: "positive" }, 0)).toBeGreaterThan(0);
  });

  it("moves downward on negative evidence", () => {
    expect(evidenceDelta({ strength: 0.8, reliability: 1, direction: "negative" }, 0)).toBeLessThan(0);
  });

  it("does not move on neutral evidence", () => {
    expect(evidenceDelta({ strength: 1, reliability: 1, direction: "neutral" }, 0)).toBe(0);
  });

  it("matches the specified magnitudes", () => {
    // magnitude 0.8 → ~+9.6 (strong), 0.35 → ~+4.2 (moderate), 0.1 → ~+1.2 (weak)
    expect(evidenceDelta({ strength: 0.8, reliability: 1, direction: "positive" }, 0)).toBeCloseTo(9.6, 5);
    expect(evidenceDelta({ strength: 0.35, reliability: 1, direction: "positive" }, 0)).toBeCloseTo(4.2, 5);
    expect(evidenceDelta({ strength: 0.1, reliability: 1, direction: "positive" }, 0)).toBeCloseTo(1.2, 5);
  });

  it("damps movement when confidence is already high", () => {
    const item = { strength: 1, reliability: 1, direction: "positive" as const };
    const cold = evidenceDelta(item, 0);
    const warm = evidenceDelta(item, 1);
    expect(warm).toBeCloseTo(cold * 0.5, 5);
    expect(warm).toBeLessThan(cold);
  });
});

describe("computeScoreUpdates", () => {
  it("sums same-element evidence within a turn", () => {
    const states = stateMap([makeState({ element_id: "E001" })]);
    const updates = computeScoreUpdates(
      [
        makeEvidence({ element_id: "E001", strength: 0.5, reliability: 0.5 }),
        makeEvidence({ element_id: "E001", strength: 0.5, reliability: 0.5 }),
      ],
      states
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].delta).toBeCloseTo(2 * 0.25 * SCORE_SCALE, 5);
  });

  it("caps a turn's combined delta at ±15", () => {
    const states = stateMap([makeState({ element_id: "E001" })]);
    const evidence = Array.from({ length: 5 }, () =>
      makeEvidence({ element_id: "E001", strength: 1, reliability: 1 })
    );
    const [update] = computeScoreUpdates(evidence, states);
    expect(update.delta).toBeCloseTo(MAX_TURN_DELTA, 5);
  });

  it("clamps into 0-100", () => {
    const high = stateMap([makeState({ element_id: "E001", score: 98 })]);
    const [up] = computeScoreUpdates(
      [makeEvidence({ element_id: "E001", strength: 1, reliability: 1, direction: "positive" })],
      high
    );
    expect(up.scoreAfter).toBe(100);

    const low = stateMap([makeState({ element_id: "E001", score: 2 })]);
    const [down] = computeScoreUpdates(
      [makeEvidence({ element_id: "E001", strength: 1, reliability: 1, direction: "negative" })],
      low
    );
    expect(down.scoreAfter).toBe(0);
  });

  it("leaves the score untouched when all evidence is neutral", () => {
    const states = stateMap([makeState({ element_id: "E001", score: 61 })]);
    const [update] = computeScoreUpdates(
      [makeEvidence({ element_id: "E001", direction: "neutral" })],
      states
    );
    expect(update.scoreAfter).toBe(61);
    expect(update.delta).toBe(0);
  });

  it("moves a high-confidence element less than a fresh one", () => {
    const item = { strength: 0.9, reliability: 0.9, direction: "positive" as const };
    const fresh = computeScoreUpdates(
      [makeEvidence({ element_id: "E001", ...item })],
      stateMap([makeState({ element_id: "E001", confidence: 0 })])
    );
    const settled = computeScoreUpdates(
      [makeEvidence({ element_id: "E001", ...item })],
      stateMap([makeState({ element_id: "E001", confidence: 0.9 })])
    );
    expect(Math.abs(settled[0].delta)).toBeLessThan(Math.abs(fresh[0].delta));
  });
});
