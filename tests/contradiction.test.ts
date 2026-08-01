import { describe, expect, it } from "vitest";
import {
  detectDirectionalContradictions,
  detectResolutions,
  validateSemanticCandidates,
} from "@/lib/engine/contradictionEngine";
import { applyTurn } from "@/lib/engine/turnUpdate";
import { makeEvidence, makeState, stateMap } from "./helpers";
import type { Contradiction } from "@/lib/types/diagnosis";

/** §13 — contradictions lower confidence; they never delete evidence. */

describe("directional detection (§13.2a)", () => {
  it("records a clash between strong opposing evidence", () => {
    const evidence = [
      makeEvidence({ element_id: "E001", direction: "positive", turn_id: 1 }),
      makeEvidence({ element_id: "E001", direction: "negative", turn_id: 3 }),
    ];
    const drafts = detectDirectionalContradictions(evidence, [], 3);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].elements).toEqual(["E001"]);
    expect(drafts[0].severity).toBeGreaterThan(0);
  });

  it("ignores clashes where either side is weak", () => {
    const evidence = [
      makeEvidence({ element_id: "E001", direction: "positive", strength: 0.9, reliability: 0.9 }),
      makeEvidence({ element_id: "E001", direction: "negative", strength: 0.3, reliability: 0.3 }),
    ];
    expect(detectDirectionalContradictions(evidence, [], 2)).toHaveLength(0);
  });

  it("halves severity when both sides come from the same turn", () => {
    const sameTurn = detectDirectionalContradictions(
      [
        makeEvidence({ element_id: "E001", direction: "positive", turn_id: 2 }),
        makeEvidence({ element_id: "E001", direction: "negative", turn_id: 2 }),
      ],
      [],
      2
    );
    const acrossTurns = detectDirectionalContradictions(
      [
        makeEvidence({ element_id: "E001", direction: "positive", turn_id: 1 }),
        makeEvidence({ element_id: "E001", direction: "negative", turn_id: 2 }),
      ],
      [],
      2
    );
    expect(sameTurn[0].severity).toBeCloseTo(acrossTurns[0].severity * 0.5, 5);
  });

  it("does not re-register an existing pair", () => {
    const a = makeEvidence({ element_id: "E001", direction: "positive", turn_id: 1 });
    const b = makeEvidence({ element_id: "E001", direction: "negative", turn_id: 2 });
    const existing: Contradiction[] = [
      {
        contradiction_id: "c1",
        elements: ["E001"],
        evidence_a: a.evidence_id,
        evidence_b: b.evidence_id,
        severity: 0.7,
        status: "unresolved",
        detected_turn: 2,
      },
    ];
    expect(detectDirectionalContradictions([a, b], existing, 3)).toHaveLength(0);
  });
});

describe("semantic candidates (§13.2b)", () => {
  const positive = makeEvidence({ element_id: "E001", direction: "positive", turn_id: 1 });
  // E077 is listed as a contrast element of E001 in the model.
  const opposing = makeEvidence({ element_id: "E077", direction: "positive", turn_id: 2 });
  const unrelated = makeEvidence({ element_id: "E064", direction: "positive", turn_id: 2 });

  it("accepts a candidate between contrast elements", () => {
    const drafts = validateSemanticCandidates(
      [{ evidence_a: positive.evidence_id, evidence_b: opposing.evidence_id }],
      [positive, opposing],
      [],
      2
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0].elements.sort()).toEqual(["E001", "E077"]);
  });

  it("discards a candidate between unrelated elements", () => {
    const drafts = validateSemanticCandidates(
      [{ evidence_a: positive.evidence_id, evidence_b: unrelated.evidence_id }],
      [positive, unrelated],
      [],
      2
    );
    expect(drafts).toHaveLength(0);
  });

  it("discards candidates referencing evidence that does not exist", () => {
    const drafts = validateSemanticCandidates(
      [{ evidence_a: "ghost-1", evidence_b: "ghost-2" }],
      [positive, opposing],
      [],
      2
    );
    expect(drafts).toHaveLength(0);
  });
});

describe("effect on the model", () => {
  it("keeps both pieces of evidence and lowers the element's confidence", () => {
    const priorEvidence = [
      makeEvidence({
        element_id: "E001",
        direction: "positive",
        turn_id: 1,
        strength: 0.9,
        reliability: 0.9,
      }),
    ];
    const states = stateMap([
      makeState({
        element_id: "E001",
        confidence: 0.3,
        evidence_count: 1,
        evidence_type_set: ["personal_experience"],
      }),
    ]);

    const withoutClash = applyTurn({
      turn: 2,
      states,
      priorEvidence,
      priorContradictions: [],
      drafts: [
        {
          element_id: "E001",
          quote: "テスト用の引用テキストです",
          type: "decision_example",
          strength: 0.9,
          reliability: 0.9,
          direction: "positive",
          context: "同方向。",
        },
      ],
      semanticCandidates: [],
      makeEvidenceId: (i) => `new-${i}`,
      makeContradictionId: (i) => `cx-${i}`,
    });

    const withClash = applyTurn({
      turn: 2,
      states,
      priorEvidence,
      priorContradictions: [],
      drafts: [
        {
          element_id: "E001",
          quote: "テスト用の引用テキストです",
          type: "decision_example",
          strength: 0.9,
          reliability: 0.9,
          direction: "negative",
          context: "逆方向。",
        },
      ],
      semanticCandidates: [],
      makeEvidenceId: (i) => `new-${i}`,
      makeContradictionId: (i) => `cx-${i}`,
    });

    expect(withClash.newContradictions).toHaveLength(1);
    expect(withoutClash.newContradictions).toHaveLength(0);

    // Both sides survive: prior evidence is untouched and the new item is stored.
    expect(withClash.newEvidence).toHaveLength(1);
    const contradiction = withClash.newContradictions[0];
    expect([contradiction.evidence_a, contradiction.evidence_b]).toContain(
      priorEvidence[0].evidence_id
    );

    const clashed = withClash.states.get("E001")!;
    const clean = withoutClash.states.get("E001")!;
    expect(clashed.confidence).toBeLessThan(clean.confidence);
  });
});

describe("resolution (§13.3)", () => {
  const a = makeEvidence({ element_id: "E001", direction: "positive", turn_id: 1 });
  const b = makeEvidence({ element_id: "E001", direction: "negative", turn_id: 2 });
  const contradiction: Contradiction = {
    contradiction_id: "c1",
    elements: ["E001"],
    evidence_a: a.evidence_id,
    evidence_b: b.evidence_id,
    severity: 0.8,
    status: "unresolved",
    detected_turn: 2,
  };

  it("resolves after two later high-reliability items agree", () => {
    const later = [
      makeEvidence({ element_id: "E001", direction: "positive", turn_id: 3, reliability: 0.8 }),
      makeEvidence({ element_id: "E001", direction: "positive", turn_id: 4, reliability: 0.9 }),
    ];
    const outcomes = detectResolutions([contradiction], [a, b, ...later]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].resolution_note).toBeTruthy();
  });

  it("does not resolve when later evidence still disagrees", () => {
    const later = [
      makeEvidence({ element_id: "E001", direction: "positive", turn_id: 3, reliability: 0.8 }),
      makeEvidence({ element_id: "E001", direction: "negative", turn_id: 4, reliability: 0.9 }),
    ];
    expect(detectResolutions([contradiction], [a, b, ...later])).toHaveLength(0);
  });

  it("does not resolve on low-reliability evidence", () => {
    const later = [
      makeEvidence({ element_id: "E001", direction: "positive", turn_id: 3, reliability: 0.4 }),
      makeEvidence({ element_id: "E001", direction: "positive", turn_id: 4, reliability: 0.5 }),
    ];
    expect(detectResolutions([contradiction], [a, b, ...later])).toHaveLength(0);
  });
});
