import { describe, expect, it } from "vitest";
import {
  MAX_PROFILE_ELEMENTS,
  MIN_ELEMENTS_PER_AXIS,
  selectContextElements,
} from "@/lib/ai/prompts";
import { AXES } from "@/lib/model/axes";
import { getElement } from "@/lib/model/elements";
import { makeState } from "./helpers";
import type { ElementState } from "@/lib/types/diagnosis";

/**
 * §37 — the element catalogue sent to Call A and Call B.
 *
 * An element that is never offered can never receive evidence, so a gap here
 * is silent: the model returns nothing and the turn is indistinguishable from
 * an uninformative answer.
 */

function axisOf(elementId: string): string {
  return getElement(elementId)!.axis_id;
}

function countByAxis(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(axisOf(id), (counts.get(axisOf(id)) ?? 0) + 1);
  return counts;
}

const emptyCtx = {
  states: new Map<string, ElementState>(),
  contradictions: [],
  recentlyUpdated: [],
};

describe("selectContextElements", () => {
  /** The regression: sorting all 100 by confidence returned E001-E020 only. */
  it("offers every axis on the very first turn", () => {
    const counts = countByAxis(selectContextElements(emptyCtx));
    for (const axis of AXES) {
      expect(counts.get(axis.axis_id) ?? 0).toBeGreaterThanOrEqual(MIN_ELEMENTS_PER_AXIS);
    }
  });

  it("spends its whole budget rather than stopping at 20", () => {
    expect(selectContextElements(emptyCtx)).toHaveLength(MAX_PROFILE_ELEMENTS);
  });

  it("never exceeds the budget", () => {
    const ids = selectContextElements({
      states: new Map<string, ElementState>(),
      contradictions: [],
      recentlyUpdated: AXES.flatMap((a) => a.element_ids).slice(0, 40),
    });
    expect(ids.length).toBeLessThanOrEqual(MAX_PROFILE_ELEMENTS);
  });

  it("returns no duplicates", () => {
    const ids = selectContextElements(emptyCtx);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic for the same input", () => {
    expect(selectContextElements(emptyCtx)).toEqual(selectContextElements(emptyCtx));
  });

  /** Within an axis the least certain still wins — the guarantee is per axis. */
  it("prefers the least certain element inside an axis", () => {
    const axis = AXES[0];
    const states = new Map<string, ElementState>();
    // Make the first element certain so it should lose its slot.
    states.set(axis.element_ids[0], makeState({ element_id: axis.element_ids[0], confidence: 0.9 }));

    const ids = selectContextElements({ states, contradictions: [], recentlyUpdated: [] });
    const chosenFromAxis = ids.filter((id) => axisOf(id) === axis.axis_id);

    // The uncertain ones still get offered...
    expect(chosenFromAxis).toContain(axis.element_ids[1]);
    // ...and the certain one is deprioritised: dropped, or ranked behind them.
    const certainRank = chosenFromAxis.indexOf(axis.element_ids[0]);
    expect(certainRank === -1 || certainRank > 0).toBe(true);
  });

  it("includes elements caught in an unresolved contradiction", () => {
    const target = AXES[9].element_ids[9];
    const ids = selectContextElements({
      states: new Map(),
      contradictions: [
        {
          contradiction_id: "cx-1",
          elements: [target],
          evidence_a: "ev-1",
          evidence_b: "ev-2",
          severity: 0.5,
          status: "unresolved",
          detected_turn: 1,
        },
      ],
      recentlyUpdated: [],
    });
    expect(ids).toContain(target);
  });
});
