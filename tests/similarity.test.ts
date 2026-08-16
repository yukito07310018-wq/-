import { describe, expect, it } from "vitest";
import { maxSimilarity, normalizeText, trigramJaccard } from "@/lib/engine/similarity";
import {
  isDuplicateQuestion,
  SIMILARITY_EXCLUSION,
  selectQuestion,
} from "@/lib/engine/questionSelector";
import { askedQuestion, candidate } from "./helpers";
import type { AskedQuestion } from "@/lib/types/diagnosis";

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
  const history: AskedQuestion[] = [
    askedQuestion({ text: "誰かの反対を押し切って決めたことはありますか", probe_kind: "decision" }),
  ];

  it("excludes candidates above the similarity threshold", () => {
    const text = "誰かの反対を押し切って決めたことはありましたか";
    expect(maxSimilarity(text, [history[0].text])).toBeGreaterThan(SIMILARITY_EXCLUSION);
    expect(isDuplicateQuestion(text, history)).toBe(true);
  });

  it("keeps a candidate that only shares a little wording", () => {
    const text = "最近やめたことは何ですか。理由も教えてください";
    expect(isDuplicateQuestion(text, history)).toBe(false);
    expect(selectQuestion([candidate("q1", text)], { askedQuestions: history })).not.toBeNull();
  });

  it("returns no selection when every candidate is a near duplicate", () => {
    const selected = selectQuestion(
      [
        candidate("a", "誰かの反対を押し切って決めたことはありましたか"),
        candidate("b", "誰かの反対を押し切って決めたことはありますか"),
      ],
      { askedQuestions: history }
    );
    expect(selected).toBeNull();
  });
});
