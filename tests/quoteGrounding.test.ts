import { describe, expect, it } from "vitest";
import {
  CONVERSATION,
  GROUNDED_ORIGINS,
  QUOTE_UNITS,
  TURN4_ANSWER,
  quoteUnitDrafts,
  type QuoteOrigin,
} from "./fixtures/miyakeHaruka";
import { EvidenceExtractionSchema } from "@/lib/validation/schemas";
import { visibleUserUtterances } from "@/lib/ai/prompts";
import {
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  verifyEvidenceQuotes,
  verifyQuote,
} from "@/lib/validation/quoteVerifier";

/**
 * §9.1 over a whole conversation.
 *
 * The single-answer fixtures cover the mechanics; this one covers the thing that
 * broke in practice — a model shown six turns of history, quoting from all of
 * them, checked against one. It also pins the two failure modes that must
 * survive the loosening: fabricated quotes, and the interviewer's own words.
 */

/** The corpus the analyst call builds: user lines in the visible window + this answer. */
const sources = [...visibleUserUtterances(CONVERSATION), TURN4_ANSWER];

function unitsWhere(...origins: QuoteOrigin[]) {
  return QUOTE_UNITS.filter((u) => origins.includes(u.origin));
}

function accepted() {
  return new Set(
    QUOTE_UNITS.filter((u) => verifyQuote(u.quote, sources).ok).map((u) => u.label)
  );
}

describe("the 三宅遥 fixture", () => {
  it("is a schema-valid Call A payload of 22 quote units", () => {
    expect(QUOTE_UNITS).toHaveLength(22);
    const parsed = EvidenceExtractionSchema.safeParse({
      evidence: quoteUnitDrafts(),
      contradiction_candidates: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("carries 18 units the user genuinely uttered", () => {
    expect(unitsWhere(...GROUNDED_ORIGINS)).toHaveLength(18);
  });
});

describe("what verification accepts", () => {
  it("accepts 16 of the 22 units", () => {
    const result = verifyEvidenceQuotes(quoteUnitDrafts(), sources);
    expect(result.accepted).toHaveLength(16);
    expect(result.rejected).toHaveLength(6);
  });

  it("accepts every quote from the current answer, short ones included", () => {
    const live = accepted();
    for (const unit of unitsWhere("current")) {
      expect(live.has(unit.label), unit.label).toBe(true);
    }
    // Three of them are under the old ten-character floor.
    expect(unitsWhere("current").filter((u) => u.chars < 10)).toHaveLength(3);
  });

  it("accepts quotes taken from earlier turns in the visible window", () => {
    const live = accepted();
    const earlier = unitsWhere("earlier").filter(
      (u) => u.chars >= MIN_QUOTE_CHARS && u.chars <= MAX_QUOTE_CHARS
    );
    expect(earlier).toHaveLength(8);
    for (const unit of earlier) {
      expect(live.has(unit.label), unit.label).toBe(true);
    }
  });

  it("accepts 「負の空間を読む」, seven characters from two turns ago", () => {
    expect(verifyQuote("負の空間を読む", sources).ok).toBe(true);
  });

  it("accepts a quote spanning the stripped <user_answer> delimiter", () => {
    const seam = unitsWhere("current_seam");
    expect(seam).toHaveLength(1);
    expect(verifyQuote(seam[0].quote, sources).ok).toBe(true);
    // It is genuinely absent from the raw answer — this is not a substring match.
    expect(TURN4_ANSWER).not.toContain(seam[0].quote);
  });
});

describe("what verification still refuses", () => {
  it("rejects every fabricated quote", () => {
    for (const unit of unitsWhere("fabricated")) {
      const check = verifyQuote(unit.quote, sources);
      expect(check.ok, unit.label).toBe(false);
      expect(check.reason).toBe("not_grounded");
    }
    expect(unitsWhere("fabricated")).toHaveLength(3);
  });

  it("rejects the interviewer's own question, verbatim though it is", () => {
    const [ai] = unitsWhere("interviewer");
    expect(CONVERSATION.some((m) => m.content.includes(ai.quote))).toBe(true);
    expect(verifyQuote(ai.quote, sources).reason).toBe("not_grounded");
  });

  it("rejects a two-character fragment even though it appears in the text", () => {
    const fragment = QUOTE_UNITS.find((u) => u.label === "floor/earlier/余白")!;
    expect(fragment.chars).toBeLessThan(MIN_QUOTE_CHARS);
    expect(verifyQuote(fragment.quote, sources).reason).toBe("too_short");
  });

  it("rejects a whole copied paragraph", () => {
    const paragraph = QUOTE_UNITS.find((u) => u.label === "ceiling/earlier/turn3を丸ごと")!;
    expect(paragraph.chars).toBeGreaterThan(MAX_QUOTE_CHARS);
    expect(verifyQuote(paragraph.quote, sources).reason).toBe("too_long");
  });
});

describe("the corpus the analyst call verifies against", () => {
  it("is the user's lines only", () => {
    expect(visibleUserUtterances(CONVERSATION)).toHaveLength(3);
    for (const text of visibleUserUtterances(CONVERSATION)) {
      expect(text.startsWith("USER")).toBe(false);
    }
  });

  it("loses the eight earlier-turn quotes when narrowed to the current answer", () => {
    // The regression this fixture exists for: same model output, one source.
    const narrow = verifyEvidenceQuotes(quoteUnitDrafts(), TURN4_ANSWER);
    expect(narrow.accepted).toHaveLength(8);
    expect(narrow.rejected.filter((r) => r.reason === "not_grounded")).toHaveLength(12);
  });
});
