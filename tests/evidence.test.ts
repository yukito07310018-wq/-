import { describe, expect, it } from "vitest";
import analystFixture from "./fixtures/analystResponse.json";
import { groundedAnswer } from "./fixtures/userAnswers";
import { EvidenceExtractionSchema } from "@/lib/validation/schemas";
import { verifyEvidenceQuotes } from "@/lib/validation/quoteVerifier";
import {
  applyTurnLimits,
  MAX_ELEMENTS_PER_TURN,
  MAX_EVIDENCE_PER_TURN,
} from "@/lib/engine/scoreEngine";
import type { EvidenceDraft, EvidenceType } from "@/lib/types/diagnosis";

/** Phase 5 — extraction fixture → validated, grounded evidence. */

function draft(overrides: Partial<EvidenceDraft> & { element_id: string }): EvidenceDraft {
  return {
    quote: "みんなは効率の問題だと言っていましたが、自分には信頼の問題に見えました",
    type: "personal_experience" as EvidenceType,
    strength: 0.6,
    reliability: 0.6,
    direction: "positive",
    context: "テスト用。",
    ...overrides,
  };
}

describe("Call A fixture", () => {
  it("passes schema validation", () => {
    const result = EvidenceExtractionSchema.safeParse(analystFixture);
    expect(result.success).toBe(true);
  });

  it("maps the fixture utterance onto the expected elements", () => {
    const parsed = EvidenceExtractionSchema.parse(analystFixture);
    const verified = verifyEvidenceQuotes(parsed.evidence, groundedAnswer);

    expect(verified.accepted).toHaveLength(3);
    expect(verified.accepted.map((e) => e.element_id).sort()).toEqual(["E001", "E029", "E051"]);
    expect(verified.rejected).toHaveLength(0);
  });

  it("rejects unknown element ids at the schema boundary", () => {
    const result = EvidenceExtractionSchema.safeParse({
      evidence: [{ ...draft({ element_id: "E999" }) }],
      contradiction_candidates: [],
    });
    expect(result.success).toBe(false);
  });
});

describe("per-turn intake limits (§9.2)", () => {
  it("keeps at most 8 items", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      draft({ element_id: `E00${(i % 6) + 1}`, strength: 0.9 - i * 0.05 })
    );
    expect(applyTurnLimits(items).length).toBeLessThanOrEqual(MAX_EVIDENCE_PER_TURN);
  });

  it("covers at most 6 elements", () => {
    const items = Array.from({ length: 10 }, (_, i) =>
      draft({ element_id: `E0${String(i + 1).padStart(2, "0")}`, strength: 0.9 - i * 0.05 })
    );
    const kept = applyTurnLimits(items);
    expect(new Set(kept.map((i) => i.element_id)).size).toBeLessThanOrEqual(MAX_ELEMENTS_PER_TURN);
  });

  it("drops the weakest items first", () => {
    const items = [
      draft({ element_id: "E001", strength: 0.2, reliability: 0.2 }),
      draft({ element_id: "E002", strength: 0.9, reliability: 0.9 }),
      ...Array.from({ length: 8 }, (_, i) =>
        draft({ element_id: `E01${i}`, strength: 0.5, reliability: 0.5 })
      ),
    ];
    const kept = applyTurnLimits(items);
    expect(kept.map((k) => k.element_id)).toContain("E002");
    expect(kept.map((k) => k.element_id)).not.toContain("E001");
  });
});
