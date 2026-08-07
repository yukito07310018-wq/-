import { describe, expect, it } from "vitest";
import fabricated from "./fixtures/fabricatedQuotes.json";
import { groundedAnswer } from "./fixtures/userAnswers";
import { EvidenceExtractionSchema } from "@/lib/validation/schemas";
import {
  FUZZY_MIN_QUOTE_CHARS,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  REPAIR_TRIGGER_REJECTIONS,
  shouldRepairBatch,
  verifyEvidenceQuotes,
  verifyQuote,
} from "@/lib/validation/quoteVerifier";

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

  it("rejects quotes shorter than the minimum", () => {
    expect([..."失敗でした"].length).toBeLessThan(MIN_QUOTE_CHARS);
    expect(verifyQuote("失敗でした", groundedAnswer).reason).toBe("too_short");
  });

  /** Japanese carries more meaning per character; a 10-char floor threw away real spans. */
  it("accepts a short verbatim Japanese span", () => {
    const quote = "自分の判断で進めました";
    expect([...quote].length).toBeGreaterThanOrEqual(MIN_QUOTE_CHARS);
    expect(verifyQuote(quote, groundedAnswer).ok).toBe(true);
  });

  it("requires short quotes to match exactly rather than fuzzily", () => {
    // Same length class as an accepted span, but not present in the answer.
    const quote = "全部やめました";
    expect([...quote].length).toBeLessThan(FUZZY_MIN_QUOTE_CHARS);
    const check = verifyQuote(quote, groundedAnswer);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("not_grounded");
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

  it("counts rejections by reason so drops are measurable", () => {
    const parsed = EvidenceExtractionSchema.parse(fabricated);
    const withShort = [...parsed.evidence, { ...parsed.evidence[0], quote: "短い" }];
    const result = verifyEvidenceQuotes(withShort, groundedAnswer);

    expect(result.rejectionCounts.not_grounded).toBe(2);
    expect(result.rejectionCounts.too_short).toBe(1);
    expect(result.rejectionCounts.too_long).toBe(0);
    const total = Object.values(result.rejectionCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(result.rejected.length);
  });
});

/** §9.1-5 — a second Call A costs a full extraction, so it must earn its place. */
describe("shouldRepairBatch", () => {
  it("repairs when nothing survived verification", () => {
    expect(shouldRepairBatch(0, 1)).toBe(true);
  });

  it("does not repair when the model simply found nothing", () => {
    expect(shouldRepairBatch(0, 0)).toBe(false);
  });

  it("does not repair a turn that already produced more evidence than it lost", () => {
    expect(shouldRepairBatch(5, 3)).toBe(false);
  });

  it("repairs when the batch was mostly ungrounded", () => {
    expect(shouldRepairBatch(1, 3)).toBe(true);
  });
});
