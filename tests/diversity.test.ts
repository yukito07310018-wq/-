import { describe, expect, it } from "vitest";
import { evidenceDiversity, evidenceTypeSet } from "@/lib/engine/diversityEngine";
import type { EvidenceType } from "@/lib/types/diagnosis";

/** §12 — entropy of the evidence-type distribution. */

const of = (types: EvidenceType[]) => types.map((type) => ({ type }));

describe("evidenceDiversity", () => {
  it("is 0 for zero or one item", () => {
    expect(evidenceDiversity([])).toBe(0);
    expect(evidenceDiversity(of(["self_description"]))).toBe(0);
  });

  it("is 0 when every item shares one type", () => {
    expect(evidenceDiversity(of(["self_description", "self_description", "self_description"]))).toBe(0);
  });

  it("ranks a five-type mix above a single-type triple", () => {
    const single = evidenceDiversity(
      of(["self_description", "self_description", "self_description"])
    );
    const mixed = evidenceDiversity(
      of([
        "self_description",
        "personal_experience",
        "decision_example",
        "emotional_reaction",
        "behavioral_example",
      ])
    );
    expect(mixed).toBeGreaterThan(single);
    expect(mixed).toBeCloseTo(1, 5);
  });

  it("places a skewed distribution between the two extremes", () => {
    const skewed = evidenceDiversity(
      of(["self_description", "self_description", "self_description", "decision_example"])
    );
    expect(skewed).toBeGreaterThan(0);
    expect(skewed).toBeLessThan(1);
  });

  it("stays within 0..1", () => {
    const many = of(
      Array.from({ length: 40 }, (_, i) =>
        (["self_description", "personal_experience", "decision_example"] as EvidenceType[])[i % 3]
      )
    );
    const value = evidenceDiversity(many);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  });
});

describe("evidenceTypeSet", () => {
  it("returns distinct types in first-seen order", () => {
    expect(
      evidenceTypeSet(of(["decision_example", "self_description", "decision_example"]))
    ).toEqual(["decision_example", "self_description"]);
  });
});
