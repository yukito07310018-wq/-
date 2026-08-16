import { describe, expect, it } from "vitest";
import {
  FULL_CONVERSATION,
  GROUNDED_ORIGINS,
  QUOTE_UNITS,
  TURN4_ANSWER,
  quoteUnitDrafts,
  type QuoteOrigin,
} from "./fixtures/miyakeHaruka";
import { EvidenceExtractionSchema } from "@/lib/validation/schemas";
import { buildTranscript, locateQuote, MAX_QUOTE_CHARS, MIN_QUOTE_CHARS } from "@/lib/validation/transcript";
import { splitByGrounding, userTranscript } from "./helpers";

/**
 * Quote grounding over a whole session.
 *
 * The single-answer cases are in `transcript.test.ts`; this one covers what
 * actually broke in practice — a model shown the whole conversation, quoting
 * from all of it. It pins the two failure modes that must survive the move to a
 * one-pass reading: quotes nobody said, and the interviewer's own words.
 */

const transcript = buildTranscript(FULL_CONVERSATION);

function unitsWhere(...origins: QuoteOrigin[]) {
  return QUOTE_UNITS.filter((u) => origins.includes(u.origin));
}

function accepted() {
  return new Set(
    QUOTE_UNITS.filter((u) => locateQuote(u.quote, transcript).ok).map((u) => u.label)
  );
}

describe("the 三宅遥 fixture", () => {
  it("is a schema-valid payload of 22 quote units", () => {
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
    const result = splitByGrounding(quoteUnitDrafts(), transcript);
    expect(result.accepted).toHaveLength(16);
    expect(result.rejected).toHaveLength(6);
  });

  it("accepts every quote from the final answer, short ones included", () => {
    const live = accepted();
    for (const unit of unitsWhere("current")) {
      expect(live.has(unit.label), unit.label).toBe(true);
    }
    // Three of them are under the old ten-character floor.
    expect(unitsWhere("current").filter((u) => u.chars < 10)).toHaveLength(3);
  });

  it("accepts quotes taken from anywhere earlier in the session", () => {
    const live = accepted();
    const earlier = unitsWhere("earlier").filter(
      (u) => u.chars >= MIN_QUOTE_CHARS && u.chars <= MAX_QUOTE_CHARS
    );
    expect(earlier).toHaveLength(8);
    for (const unit of earlier) {
      expect(live.has(unit.label), unit.label).toBe(true);
    }
  });

  it("accepts 「負の空間を読む」, seven characters from turn 2", () => {
    expect(locateQuote("負の空間を読む", transcript)).toMatchObject({ ok: true, turn: 2 });
  });

  it("accepts a quote spanning the stripped <user_answer> delimiter", () => {
    const seam = unitsWhere("current_seam");
    expect(seam).toHaveLength(1);
    expect(locateQuote(seam[0].quote, transcript).ok).toBe(true);
    // It is genuinely absent from the raw answer — this is not a substring match.
    expect(TURN4_ANSWER).not.toContain(seam[0].quote);
  });
});

describe("what verification still refuses", () => {
  it("rejects every fabricated quote", () => {
    for (const unit of unitsWhere("fabricated")) {
      expect(locateQuote(unit.quote, transcript), unit.label).toMatchObject({
        ok: false,
        reason: "not_grounded",
      });
    }
    expect(unitsWhere("fabricated")).toHaveLength(3);
  });

  it("rejects the interviewer's own question, verbatim though it is", () => {
    const [ai] = unitsWhere("interviewer");
    expect(FULL_CONVERSATION.some((m) => m.content.includes(ai.quote))).toBe(true);
    expect(locateQuote(ai.quote, transcript)).toMatchObject({ reason: "not_grounded" });
  });

  it("rejects a two-character fragment even though it appears in the text", () => {
    const fragment = QUOTE_UNITS.find((u) => u.label === "floor/earlier/余白")!;
    expect(fragment.chars).toBeLessThan(MIN_QUOTE_CHARS);
    expect(locateQuote(fragment.quote, transcript)).toMatchObject({ reason: "too_short" });
  });

  it("rejects a whole copied paragraph", () => {
    const paragraph = QUOTE_UNITS.find((u) => u.label === "ceiling/earlier/turn3を丸ごと")!;
    expect(paragraph.chars).toBeGreaterThan(MAX_QUOTE_CHARS);
    expect(locateQuote(paragraph.quote, transcript)).toMatchObject({ reason: "too_long" });
  });
});

describe("the corpus the reading verifies against", () => {
  it("holds four user answers and no interviewer line", () => {
    const userLines = FULL_CONVERSATION.filter((m) => m.role === "user");
    expect(userLines).toHaveLength(4);
    for (const line of FULL_CONVERSATION.filter((m) => m.role === "assistant")) {
      expect(locateQuote(line.content.slice(0, 20), transcript).ok).toBe(false);
    }
  });

  it("loses the eight earlier-turn quotes when narrowed to the last answer", () => {
    // The regression this fixture exists for: same model output, one source.
    const narrow = splitByGrounding(quoteUnitDrafts(), userTranscript(TURN4_ANSWER));
    expect(narrow.accepted).toHaveLength(8);
    expect(narrow.rejected).toHaveLength(14);
  });
});
