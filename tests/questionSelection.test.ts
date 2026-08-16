import { describe, expect, it } from "vitest";
import questionFixture from "./fixtures/questionCandidates.json";
import { QuestionGenerationSchema } from "@/lib/validation/schemas";
import { selectQuestion } from "@/lib/engine/questionSelector";
import { nextMode, topicRun, TOPIC_TURNS } from "@/lib/engine/questionFlow";
import {
  OPENING_QUESTIONS,
  pickFallbackQuestion,
  pickOpeningQuestion,
} from "@/lib/engine/fallbackQuestions";
import { asked, askedQuestion, candidate } from "./helpers";
import type { AskedQuestion } from "@/lib/types/diagnosis";

/**
 * How the interview decides what to ask.
 *
 * Everything the old QValue weighed — which elements looked least measured,
 * which axis had not been visited, how unlike the last three questions this one
 * was — is gone. What is left is a topic that gets four turns and a rule against
 * asking the same thing twice.
 */

describe("Call B fixture", () => {
  it("passes schema validation and carries no element targets", () => {
    const parsed = QuestionGenerationSchema.parse(questionFixture);
    expect(parsed.questions).toHaveLength(3);
    expect(parsed.answer_signal).toBe("normal");
    for (const q of parsed.questions) {
      expect(q).not.toHaveProperty("target_elements");
    }
  });

  it("defaults answer_signal when the model omits it", () => {
    const withoutSignal: Record<string, unknown> = { ...questionFixture };
    delete withoutSignal.answer_signal;
    expect(QuestionGenerationSchema.parse(withoutSignal).answer_signal).toBe("normal");
  });
});

describe("topicRun", () => {
  it("counts the opener plus everything deepened on top of it", () => {
    expect(topicRun(asked(["opening", "deepen", "deepen"]))).toBe(3);
  });

  it("restarts at the switch", () => {
    expect(topicRun(asked(["opening", "deepen", "deepen", "switch", "deepen"]))).toBe(2);
  });

  it("is 0 before anything has been asked", () => {
    expect(topicRun([])).toBe(0);
  });
});

describe("nextMode", () => {
  it("opens when nothing has been asked", () => {
    expect(nextMode([])).toBe("opening");
  });

  it("stays on the topic for four questions", () => {
    expect(nextMode(asked(["opening"]))).toBe("deepen");
    expect(nextMode(asked(["opening", "deepen"]))).toBe("deepen");
    expect(nextMode(asked(["opening", "deepen", "deepen"]))).toBe("deepen");
  });

  it("switches once the topic has had its four", () => {
    const block = asked(["opening", "deepen", "deepen", "deepen"]);
    expect(block).toHaveLength(TOPIC_TURNS);
    expect(topicRun(block)).toBe(TOPIC_TURNS);
    expect(nextMode(block)).toBe("switch");
  });

  it("releases the topic early on a flat わからない", () => {
    expect(nextMode(asked(["opening"]), "flat_unknown")).toBe("switch");
  });

  it("keeps digging when the user reaches for a metaphor or answers sideways", () => {
    // Both mean the question landed near something; neither is an empty subject.
    expect(nextMode(asked(["opening"]), "metaphor")).toBe("deepen");
    expect(nextMode(asked(["opening"]), "deflect")).toBe("deepen");
  });

  it("does not let a signal extend a topic past its four", () => {
    const spent = asked(["opening", "deepen", "deepen", "deepen"]);
    expect(nextMode(spent, "metaphor")).toBe("switch");
  });
});

describe("openers", () => {
  it("hands out the four openers in file order, one per topic", () => {
    const history: AskedQuestion[] = [];
    const seen: string[] = [];
    for (let i = 0; i < OPENING_QUESTIONS.length; i++) {
      const opener = pickOpeningQuestion(history)!;
      seen.push(opener.question_id);
      history.push(askedQuestion({ turn: i, text: opener.text, mode: "switch" }));
    }
    expect(seen).toEqual(OPENING_QUESTIONS.map((q) => q.question_id));
  });

  it("is deterministic — the same history always yields the same opener", () => {
    expect(pickOpeningQuestion()!.question_id).toBe(pickOpeningQuestion()!.question_id);
    expect(pickOpeningQuestion()!.question_id).toBe(OPENING_QUESTIONS[0].question_id);
  });

  it("returns null once all four are spent, so Call B has to find the subject", () => {
    const history = OPENING_QUESTIONS.map((q, i) =>
      askedQuestion({ turn: i, text: q.text, mode: "switch" })
    );
    expect(pickOpeningQuestion(history)).toBeNull();
  });
});

describe("fallbacks", () => {
  it("returns an unused fallback and skips asked ones", () => {
    const first = pickFallbackQuestion([])!;
    const second = pickFallbackQuestion([askedQuestion({ text: first.text })])!;
    expect(second.question_id).not.toBe(first.question_id);
  });

  it("respects banned probe kinds", () => {
    const picked = pickFallbackQuestion([], ["failure", "conflict"]);
    expect(picked).not.toBeNull();
    expect(["failure", "conflict"]).not.toContain(picked!.probe_kind);
  });
});

describe("selectQuestion", () => {
  it("takes the model's first choice when nothing is a repeat", () => {
    const selected = selectQuestion(
      [candidate("a", "最初にどこから手をつけましたか"), candidate("b", "別の質問です")],
      { askedQuestions: [] }
    );
    expect(selected?.question_id).toBe("a");
  });

  it("skips a near-repeat and takes the next one", () => {
    const history = [askedQuestion({ text: "誰かの反対を押し切って決めたことはありますか" })];
    const selected = selectQuestion(
      [
        candidate("repeat", "誰かの反対を押し切って決めたことはありましたか"),
        candidate("fresh", "そのとき、何が引っかかっていましたか"),
      ],
      { askedQuestions: history }
    );
    expect(selected?.question_id).toBe("fresh");
  });

  it("returns null when every candidate is a near duplicate", () => {
    const history = [askedQuestion({ text: "誰かの反対を押し切って決めたことはありますか" })];
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
