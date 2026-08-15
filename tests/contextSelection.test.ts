import { describe, expect, it } from "vitest";
import {
  LEAST_MEASURED_SLOTS,
  MAX_PROFILE_ELEMENTS,
  selectContextElements,
} from "@/lib/ai/prompts";
import { AXES } from "@/lib/model/axes";
import { ELEMENT_IDS } from "@/lib/model/elements";
import { makeState, stateMap, uniformStates } from "./helpers";
import type { Contradiction } from "@/lib/types/diagnosis";

/**
 * §37 — which elements the models are allowed to see.
 *
 * The catalogue is the interview's entire search space: an element that never
 * appears in it can never gather evidence, so its axis can never leave coverage
 * zero. Almost every comparison in the selector is a tie, which makes the
 * tie-break the thing that actually decides what gets explored.
 */

const untouched = () => uniformStates(ELEMENT_IDS);

function axesIn(ids: readonly string[]): Set<string> {
  const found = new Set<string>();
  for (const axis of AXES) {
    if (axis.element_ids.some((id) => ids.includes(id))) found.add(axis.axis_id);
  }
  return found;
}

describe("selectContextElements on an untouched profile", () => {
  it("offers all ten axes on the very first turn", () => {
    const ids = selectContextElements({
      states: untouched(),
      contradictions: [],
      recentlyUpdated: [],
      turn: 1,
    });
    expect(axesIn(ids).size).toBe(10);
  });

  it("no longer returns the first twenty element ids", () => {
    // The regression: ties resolved by id gave E001-E020 — AX01 and AX02 only —
    // on every turn of every session.
    const ids = selectContextElements({
      states: untouched(),
      contradictions: [],
      recentlyUpdated: [],
      turn: 1,
    });
    const firstTwenty = ELEMENT_IDS.slice(0, 20);
    expect(ids.slice(0, LEAST_MEASURED_SLOTS)).not.toEqual(firstTwenty);
    expect(ids.filter((id) => firstTwenty.includes(id)).length).toBeLessThan(10);
  });

  it("sweeps all 100 elements within ten turns", () => {
    const seen = new Set<string>();
    for (let turn = 1; turn <= 10; turn++) {
      for (const id of selectContextElements({
        states: untouched(),
        contradictions: [],
        recentlyUpdated: [],
        turn,
      })) {
        seen.add(id);
      }
    }
    expect(seen.size).toBe(100);
  });

  it("shows a different slice each turn", () => {
    const a = selectContextElements({
      states: untouched(),
      contradictions: [],
      recentlyUpdated: [],
      turn: 1,
    });
    const b = selectContextElements({
      states: untouched(),
      contradictions: [],
      recentlyUpdated: [],
      turn: 2,
    });
    expect(a).not.toEqual(b);
  });

  it("is deterministic for a given turn", () => {
    const ctx = {
      states: untouched(),
      contradictions: [] as Contradiction[],
      recentlyUpdated: [] as string[],
      turn: 7,
    };
    expect(selectContextElements(ctx)).toEqual(selectContextElements(ctx));
  });
});

describe("selectContextElements once evidence exists", () => {
  it("still prefers the least certain element over the rotation", () => {
    // Rotation only breaks ties: a measured element must lose to an unmeasured
    // one in the same axis regardless of where the turn counter points.
    const AX01 = AXES[0].element_ids;
    const states = stateMap([
      ...AX01.slice(0, 9).map((id) =>
        makeState({ element_id: id, confidence: 0.9, evidence_count: 5 })
      ),
      makeState({ element_id: AX01[9], confidence: 0, evidence_count: 0 }),
    ]);

    for (let turn = 1; turn <= 10; turn++) {
      const ids = selectContextElements({ states, contradictions: [], recentlyUpdated: [], turn });
      const fromAX01 = ids.filter((id) => AX01.includes(id));
      expect(fromAX01[0], `turn ${turn}`).toBe(AX01[9]);
    }
  });

  it("keeps room for what was just touched and for contradictions", () => {
    const contradiction: Contradiction = {
      contradiction_id: "cx-1",
      elements: ["E077"],
      evidence_a: "ev-1",
      evidence_b: "ev-2",
      severity: 0.6,
      status: "unresolved",
      detected_turn: 2,
    };
    const ids = selectContextElements({
      states: untouched(),
      contradictions: [contradiction],
      recentlyUpdated: ["E044"],
      turn: 3,
    });

    expect(ids).toContain("E044");
    expect(ids).toContain("E077");
    expect(ids.length).toBeLessThanOrEqual(MAX_PROFILE_ELEMENTS);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns only real element ids", () => {
    const ids = selectContextElements({
      states: untouched(),
      contradictions: [],
      recentlyUpdated: ["E999"],
      turn: 4,
    });
    for (const id of ids) expect(ELEMENT_IDS).toContain(id);
  });
});
