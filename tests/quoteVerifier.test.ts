import { describe, expect, it } from "vitest";
import fabricated from "./fixtures/fabricatedQuotes.json";
import { groundedAnswer } from "./fixtures/userAnswers";
import { EvidenceExtractionSchema } from "@/lib/validation/schemas";
import {
  MAX_QUOTE_CHARS,
  MIN_SUBSTANTIVE_ANSWER_CHARS,
  REPAIR_TRIGGER_REJECTIONS,
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

  it("rejects quotes shorter than 10 characters", () => {
    expect(verifyQuote("失敗でした", groundedAnswer).reason).toBe("too_short");
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
});

/**
 * A turn that banks no evidence advances the interview without advancing the
 * model. Left unchecked it accumulates: the user answers every question and the
 * diagnosis is still built on nothing, so an empty result is re-run rather than
 * accepted.
 */
describe("empty extraction", () => {
  it("requests a repair when a real answer yielded nothing", () => {
    expect([...groundedAnswer].length).toBeGreaterThanOrEqual(MIN_SUBSTANTIVE_ANSWER_CHARS);

    const result = verifyEvidenceQuotes([], groundedAnswer);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    // Below REPAIR_TRIGGER_REJECTIONS, so only the empty-result rule can fire.
    expect(result.shouldRepair).toBe(true);
  });

  it("requests a repair when every item was ungrounded, even below the threshold", () => {
    const parsed = EvidenceExtractionSchema.parse(fabricated);
    const onlyFabricated = parsed.evidence.filter(
      (e) => !verifyQuote(e.quote, groundedAnswer).ok
    );

    const result = verifyEvidenceQuotes(onlyFabricated, groundedAnswer);

    expect(result.accepted).toHaveLength(0);
    expect(result.rejected.length).toBeLessThan(REPAIR_TRIGGER_REJECTIONS);
    expect(result.shouldRepair).toBe(true);
  });

  it("accepts an empty result for an answer too short to quote", () => {
    const brief = "特にないです";
    expect([...brief].length).toBeLessThan(MIN_SUBSTANTIVE_ANSWER_CHARS);

    const result = verifyEvidenceQuotes([], brief);

    // Nothing to re-extract — this is a fair reading, not a failed extraction.
    expect(result.shouldRepair).toBe(false);
  });

  it("does not request a repair when something was accepted", () => {
    const parsed = EvidenceExtractionSchema.parse(fabricated);
    const result = verifyEvidenceQuotes(parsed.evidence, groundedAnswer);

    expect(result.accepted.length).toBeGreaterThan(0);
    expect(result.shouldRepair).toBe(false);
  });
});
