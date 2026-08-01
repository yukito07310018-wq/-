import { describe, expect, it } from "vitest";
import { maxSimilarity, normalizeText, trigramJaccard } from "@/lib/engine/similarity";
import { scoreCandidate, SIMILARITY_EXCLUSION, selectQuestion } from "@/lib/engine/questionSelector";
import { uniformStates } from "./helpers";
import { ELEMENT_IDS } from "@/lib/model/elements";
import type { AskedQuestion, QuestionCandidate } from "@/lib/types/diagnosis";

/** §21 — deterministic similarity, and its use as a repetition guard. */

describe("normalizeText", () => {
  it("strips whitespace, punctuation and case, and folds width", () => {
    expect(normalizeText("Ａｂ Ｃ、です。")).toBe("abcです");
  });
});

describe("trigramJaccard", () => {
  it("returns 1 for identical text", () => {
    const text = "誰かの反対を押し切って決めたことはありますか";
    expect(trigramJaccard(text, text)).toBe(1);
  });

  it("returns 1 for text differing only in punctuation", () => {
    expect(trigramJaccard("失敗した経験はありますか？", "失敗した経験はありますか")).toBe(1);
  });

  it("returns a low value for unrelated text", () => {
    const value = trigramJaccard(
      "十年後の社会はどうなっていると思いますか",
      "朝はいつも何時に起きていますか"
    );
    expect(value).toBeLessThan(0.2);
  });

  it("returns a high value for a close paraphrase", () => {
    const value = trigramJaccard(
      "誰かの反対を押し切って決めたことはありますか",
      "誰かの反対を押し切って決めたことはありましたか"
    );
    expect(value).toBeGreaterThan(0.75);
  });

  it("is symmetric", () => {
    const a = "続けているうちにやり方を変えたことはありますか";
    const b = "やり方を自分で変えた経験はありますか";
    expect(trigramJaccard(a, b)).toBeCloseTo(trigramJaccard(b, a), 12);
  });
});

describe("maxSimilarity", () => {
  it("is 0 against an empty history", () => {
    expect(maxSimilarity("何かありますか", [])).toBe(0);
  });

  it("picks the closest past item", () => {
    const value = maxSimilarity("失敗した経験はありますか", [
      "朝は何時に起きますか",
      "失敗した経験はありますか",
    ]);
    expect(value).toBe(1);
  });
});

describe("repetition guard in selection", () => {
  const states = uniformStates(ELEMENT_IDS);

  function candidate(text: string, id = "q1"): QuestionCandidate {
    return {
      question_id: id,
      text,
      target_elements: ["E001"],
      probe_kind: "experience",
      expected_yield: 0.7,
      rationale: "",
    };
  }

  const asked: AskedQuestion[] = [
    {
      turn: 1,
      text: "誰かの反対を押し切って決めたことはありますか",
      target_elements: ["E051"],
      probe_kind: "decision",
      q_value: 0.5,
    },
  ];

  it("excludes candidates above the similarity threshold", () => {
    const breakdown = scoreCandidate(
      candidate("誰かの反対を押し切って決めたことはありましたか"),
      { states, contradictions: [], askedQuestions: asked }
    );
    expect(breakdown.similarity_penalty).toBeGreaterThan(SIMILARITY_EXCLUSION);
    expect(breakdown.excluded).toBe(true);
    expect(breakdown.q_value).toBe(0);
  });

  it("discounts, but keeps, moderately similar candidates", () => {
    const distinct = scoreCandidate(candidate("最近やめたことは何ですか。理由も教えてください"), {
      states,
      contradictions: [],
      askedQuestions: asked,
    });
    expect(distinct.excluded).toBe(false);
    expect(distinct.q_value).toBeGreaterThan(0);
  });

  it("returns no selection when every candidate is a near duplicate", () => {
    const result = selectQuestion(
      [
        candidate("誰かの反対を押し切って決めたことはありましたか", "a"),
        candidate("誰かの反対を押し切って決めたことはありますか", "b"),
      ],
      { states, contradictions: [], askedQuestions: asked }
    );
    expect(result.selected).toBeNull();
  });
});
