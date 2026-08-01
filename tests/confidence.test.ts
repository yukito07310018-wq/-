import { describe, expect, it } from "vitest";
import {
  applyContradictionPenalty,
  confidenceCapByTypeCount,
  recomputeConfidenceFromEvidence,
  updateConfidence,
} from "@/lib/engine/confidenceEngine";
import type { EvidenceType } from "@/lib/types/diagnosis";

/** §11 — confidence is about evidential support, and is deliberately hard to max. */

function items(types: EvidenceType[], strength = 0.9, reliability = 0.9) {
  return types.map((type) => ({ type, strength, reliability }));
}

describe("confidence accumulation", () => {
  it("rises as evidence arrives", () => {
    const first = updateConfidence({
      confidenceBefore: 0,
      evidenceThisTurn: items(["personal_experience"]),
      typeSetBefore: [],
      contradictions: [],
    });
    expect(first.confidence).toBeGreaterThan(0);

    const second = updateConfidence({
      confidenceBefore: first.confidence,
      evidenceThisTurn: items(["decision_example"]),
      typeSetBefore: first.typeSetAfter,
      contradictions: [],
    });
    expect(second.confidence).toBeGreaterThan(first.confidence);
  });

  it("stays independent of score: confidence can rise on neutral evidence", () => {
    const result = updateConfidence({
      confidenceBefore: 0,
      evidenceThisTurn: [
        { type: "reasoning_pattern" as EvidenceType, strength: 0.8, reliability: 0.8 },
      ],
      typeSetBefore: [],
      contradictions: [],
    });
    // The same item contributes 0 score delta when its direction is neutral,
    // yet still adds support for the estimate.
    expect(result.confidence).toBeGreaterThan(0);
  });
});

describe("diversity cap (§11.2)", () => {
  it("defines the specified ceilings", () => {
    expect(confidenceCapByTypeCount(1)).toBe(0.4);
    expect(confidenceCapByTypeCount(2)).toBe(0.65);
    expect(confidenceCapByTypeCount(3)).toBe(0.85);
    expect(confidenceCapByTypeCount(7)).toBe(1);
  });

  it("caps a pile of same-type evidence at 0.40", () => {
    let confidence = 0;
    let typeSet: string[] = [];
    for (let i = 0; i < 30; i++) {
      const result = updateConfidence({
        confidenceBefore: confidence,
        evidenceThisTurn: items(["self_description"], 1, 1),
        typeSetBefore: typeSet,
        contradictions: [],
      });
      confidence = result.confidence;
      typeSet = result.typeSetAfter;
    }
    expect(confidence).toBeCloseTo(0.4, 5);
  });

  it("allows above 0.65 once a third type appears", () => {
    let confidence = 0;
    let typeSet: string[] = [];
    const types: EvidenceType[] = ["self_description", "personal_experience", "decision_example"];
    for (let i = 0; i < 30; i++) {
      const result = updateConfidence({
        confidenceBefore: confidence,
        evidenceThisTurn: items([types[i % 3]], 1, 1),
        typeSetBefore: typeSet,
        contradictions: [],
      });
      confidence = result.confidence;
      typeSet = result.typeSetAfter;
    }
    expect(confidence).toBeGreaterThan(0.65);
    expect(confidence).toBeLessThanOrEqual(0.85);
  });

  it("discounts repeat types within a single turn", () => {
    const varied = updateConfidence({
      confidenceBefore: 0,
      evidenceThisTurn: items(["personal_experience", "decision_example"]),
      typeSetBefore: [],
      contradictions: [],
    });
    const repeated = updateConfidence({
      confidenceBefore: 0,
      evidenceThisTurn: items(["personal_experience", "personal_experience"]),
      typeSetBefore: [],
      contradictions: [],
    });
    expect(repeated.confidence).toBeLessThan(varied.confidence);
  });
});

describe("contradiction penalty (§11.3)", () => {
  it("reduces confidence for unresolved contradictions only", () => {
    const base = 0.8;
    const unresolved = applyContradictionPenalty(base, [
      { severity: 0.8, status: "unresolved" },
    ]);
    const resolved = applyContradictionPenalty(base, [{ severity: 0.8, status: "resolved" }]);

    expect(unresolved).toBeCloseTo(0.8 * (1 - 0.25 * 0.8), 5);
    expect(resolved).toBe(base);
  });

  it("compounds across multiple contradictions", () => {
    const one = applyContradictionPenalty(1, [{ severity: 1, status: "unresolved" }]);
    const two = applyContradictionPenalty(1, [
      { severity: 1, status: "unresolved" },
      { severity: 1, status: "unresolved" },
    ]);
    expect(two).toBeLessThan(one);
  });

  it("restores confidence when the contradiction is resolved", () => {
    const evidence = [
      { type: "personal_experience" as EvidenceType, strength: 0.9, reliability: 0.9, turn_id: 1 },
      { type: "decision_example" as EvidenceType, strength: 0.9, reliability: 0.9, turn_id: 2 },
    ];
    const penalised = recomputeConfidenceFromEvidence(evidence, [
      { severity: 0.9, status: "unresolved" },
    ]);
    const restored = recomputeConfidenceFromEvidence(evidence, [
      { severity: 0.9, status: "resolved" },
    ]);
    expect(restored.confidence).toBeGreaterThan(penalised.confidence);
  });

  it("replays turn by turn so a recompute matches the incremental path", () => {
    const evidence = [
      { type: "personal_experience" as EvidenceType, strength: 0.8, reliability: 0.7, turn_id: 1 },
      { type: "decision_example" as EvidenceType, strength: 0.6, reliability: 0.9, turn_id: 2 },
      { type: "value_statement" as EvidenceType, strength: 0.7, reliability: 0.7, turn_id: 3 },
    ];

    let confidence = 0;
    let typeSet: string[] = [];
    for (const item of evidence) {
      const step = updateConfidence({
        confidenceBefore: confidence,
        evidenceThisTurn: [item],
        typeSetBefore: typeSet,
        contradictions: [],
      });
      confidence = step.confidence;
      typeSet = step.typeSetAfter;
    }

    const replayed = recomputeConfidenceFromEvidence(evidence, []);
    expect(replayed.confidence).toBeCloseTo(confidence, 10);
  });
});
