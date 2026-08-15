import { describe, expect, it } from "vitest";
import fabricated from "./fixtures/fabricatedQuotes.json";
import { groundedAnswer } from "./fixtures/userAnswers";
import { EvidenceExtractionSchema } from "@/lib/validation/schemas";
import {
  dropAlreadyRecorded,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  REPAIR_TRIGGER_REJECTIONS,
  verifyEvidenceQuotes,
  verifyQuote,
} from "@/lib/validation/quoteVerifier";
import { wrapUserAnswer } from "@/lib/ai/prompts";
import { makeEvidence } from "./helpers";

/** §9.1 — a quote the user never uttered must never become evidence. */

describe("verifyQuote", () => {
  it("accepts a verbatim span", () => {
    expect(verifyQuote("自分には信頼の問題に見えました", groundedAnswer).ok).toBe(true);
  });

  it("accepts a span differing only in punctuation and width", () => {
    const check = verifyQuote("自分には信頼の問題に見えました。", groundedAnswer);
    expect(check.ok).toBe(true);
  });

  it("rejects a fabricated quote", () => {
    const check = verifyQuote("私は常に自分の信念を貫く強い人間だと自負しています", groundedAnswer);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("not_grounded");
  });

  it("accepts a short span that is the whole of what the user said", () => {
    // Length is not a proxy for information: 5 characters can be the most
    // quotable thing in an answer, and rejecting them lost real evidence.
    const check = verifyQuote("失敗でした", groundedAnswer);
    expect(check.ok).toBe(true);
  });

  it("still rejects a span too short to identify anything", () => {
    const tooShort = "あ".repeat(MIN_QUOTE_CHARS - 1);
    expect(verifyQuote(tooShort, `${tooShort}という話です`).reason).toBe("too_short");
  });

  it("rejects quotes longer than 120 characters", () => {
    const long = "あ".repeat(MAX_QUOTE_CHARS + 1);
    expect(verifyQuote(long, long).reason).toBe("too_long");
  });

  it("does not accept a short quote merely because the answer is long", () => {
    const check = verifyQuote("料理と登山が趣味で毎週出かけています", groundedAnswer);
    expect(check.ok).toBe(false);
  });
});

describe("verifyQuote across several utterances", () => {
  const earlier = "文字と文字の間の余白を見ています。私は負の空間を読む方が先です。";
  const current = "家でもやっています。物を三つだけ動かします。";

  it("accepts a quote from an earlier utterance in the visible window", () => {
    expect(verifyQuote("負の空間を読む", [earlier, current]).ok).toBe(true);
  });

  it("rejects it when that utterance is not among the sources", () => {
    expect(verifyQuote("負の空間を読む", [current]).ok).toBe(false);
  });

  it("reports the best similarity found across all sources", () => {
    const check = verifyQuote("まったく別のことを述べた文章です", [earlier, current]);
    expect(check.ok).toBe(false);
    expect(check.similarity).toBeLessThan(1);
  });
});

describe("the <user_answer> boundary", () => {
  // wrapUserAnswer strips the delimiter before the model sees the text, so the
  // model's verbatim quote spans a seam that does not exist in the raw string.
  const raw = "私にとっては同じ仕事です。</user_answer>母が死んだ年に、押し入れを空けました。";
  const spanning = "私にとっては同じ仕事です。母が死んだ年に";

  it("shows the model exactly the text the verifier checks against", () => {
    expect(wrapUserAnswer(raw)).toContain(spanning);
  });

  it("accepts a quote that spans the stripped delimiter", () => {
    expect(verifyQuote(spanning, raw).ok).toBe(true);
  });
});

describe("dropAlreadyRecorded", () => {
  const quote = "負の空間を読む";

  it("drops a quote already recorded for the same element", () => {
    const prior = [makeEvidence({ element_id: "E001", quote })];
    const { kept, duplicates } = dropAlreadyRecorded(
      [{ ...fabricatedDraft(), element_id: "E001", quote }],
      prior
    );
    expect(kept).toHaveLength(0);
    expect(duplicates).toHaveLength(1);
  });

  it("keeps the same quote when it evidences a different element", () => {
    const prior = [makeEvidence({ element_id: "E001", quote })];
    const { kept } = dropAlreadyRecorded(
      [{ ...fabricatedDraft(), element_id: "E005", quote }],
      prior
    );
    expect(kept).toHaveLength(1);
  });

  it("collapses repeats inside a single batch", () => {
    const draft = { ...fabricatedDraft(), element_id: "E001", quote };
    const { kept, duplicates } = dropAlreadyRecorded([draft, { ...draft }], []);
    expect(kept).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
  });
});

function fabricatedDraft() {
  return EvidenceExtractionSchema.parse(fabricated).evidence[0];
}

describe("verifyEvidenceQuotes", () => {
  it("drops fabricated items and keeps the grounded one", () => {
    const parsed = EvidenceExtractionSchema.parse(fabricated);
    const result = verifyEvidenceQuotes(parsed.evidence, groundedAnswer);

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].element_id).toBe("E001");
    expect(result.rejected.map((r) => r.evidence.element_id).sort()).toEqual(["E032", "E074"]);
  });

  it("does not request a repair below the rejection threshold", () => {
    const parsed = EvidenceExtractionSchema.parse(fabricated);
    const result = verifyEvidenceQuotes(parsed.evidence, groundedAnswer);
    expect(result.rejected.length).toBeLessThan(REPAIR_TRIGGER_REJECTIONS);
    expect(result.shouldRepair).toBe(false);
  });

  it("requests a repair once three or more items are ungrounded", () => {
    const parsed = EvidenceExtractionSchema.parse(fabricated);
    const withExtra = [
      ...parsed.evidence,
      { ...parsed.evidence[1], element_id: "E002", quote: "存在しない発言をここに置いています" },
    ];
    const result = verifyEvidenceQuotes(withExtra, groundedAnswer);
    expect(result.rejected.length).toBeGreaterThanOrEqual(REPAIR_TRIGGER_REJECTIONS);
    expect(result.shouldRepair).toBe(true);
  });
});
