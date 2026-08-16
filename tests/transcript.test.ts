import { describe, expect, it } from "vitest";
import {
  buildTranscript,
  locateQuote,
  MAX_QUOTE_CHARS,
  MIN_QUOTE_CHARS,
  UTTERANCE_SEPARATOR,
} from "@/lib/validation/transcript";
import { wrapUserAnswer } from "@/lib/ai/prompts";
import { normalizeText, normalizeTracked } from "@/lib/engine/similarity";
import { userTranscript } from "./helpers";
import type { ConversationMessage } from "@/lib/db/repository";

/**
 * Quote grounding for the batch reading.
 *
 * The mechanics that used to live in `quoteVerifier` against a six-turn sliding
 * window, now against one corpus built from the whole session — and, unlike
 * before, reporting which turn a quote came from, because the return count
 * depends on placing every quote in the conversation.
 */

const ANSWER = "みんなは効率の問題だと言っていましたが、自分には信頼の問題に見えました。";

describe("locateQuote", () => {
  it("accepts a verbatim span", () => {
    expect(locateQuote("信頼の問題に見えました", userTranscript(ANSWER)).ok).toBe(true);
  });

  it("accepts a span differing only in punctuation and width", () => {
    const found = locateQuote("みんなは効率の問題だと言っていましたが", userTranscript(ANSWER));
    expect(found.ok).toBe(true);
  });

  it("rejects a fabricated quote", () => {
    const found = locateQuote("私は常に本質を見抜くことができます", userTranscript(ANSWER));
    expect(found.ok).toBe(false);
    expect(found).toMatchObject({ reason: "not_grounded" });
  });

  it("accepts a short span that is the whole of what the user said", () => {
    // Japanese carries meaning densely; three characters is the floor, not ten.
    expect(locateQuote("余白を読む", userTranscript("余白を読むのが先です")).ok).toBe(true);
    expect(MIN_QUOTE_CHARS).toBe(3);
  });

  it("still rejects a span too short to identify anything", () => {
    const found = locateQuote("余白", userTranscript("余白のことをよく考えます"));
    expect(found).toMatchObject({ ok: false, reason: "too_short" });
  });

  it("rejects quotes longer than 120 characters", () => {
    const long = "あ".repeat(MAX_QUOTE_CHARS + 1);
    expect(locateQuote(long, userTranscript(long))).toMatchObject({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("which turn a quote came from", () => {
  const transcript = userTranscript("最初の話です。看板を作っています", "次の話です。余白を読みます");

  it("reports the turn of the utterance it found", () => {
    expect(locateQuote("看板を作っています", transcript)).toMatchObject({ ok: true, turn: 1 });
    expect(locateQuote("余白を読みます", transcript)).toMatchObject({ ok: true, turn: 2 });
  });

  it("uses the real turn index, not the position in the corpus", () => {
    const conversation: ConversationMessage[] = [
      { turnIndex: 0, role: "assistant", content: "最初の質問です" },
      { turnIndex: 4, role: "user", content: "四問目に話したことです" },
      { turnIndex: 7, role: "user", content: "七問目に話したことです" },
    ];
    const built = buildTranscript(conversation);
    expect(locateQuote("四問目に話したこと", built)).toMatchObject({ turn: 4 });
    expect(locateQuote("七問目に話したこと", built)).toMatchObject({ turn: 7 });
  });
});

describe("the corpus is the user's lines and nothing else", () => {
  const conversation: ConversationMessage[] = [
    { turnIndex: 1, role: "assistant", content: "その「自分の線」というのは、具体的にどういうものですか。" },
    { turnIndex: 1, role: "user", content: "文字と文字の間の余白を見ています。" },
  ];
  const transcript = buildTranscript(conversation);

  it("refuses the interviewer's own question, verbatim though it is", () => {
    // The single failure mode a whole-transcript corpus would let through: the
    // model quoting a sentence it wrote itself.
    const aiWords = "具体的にどういうものですか";
    expect(conversation[0].content).toContain(aiWords);
    expect(locateQuote(aiWords, transcript)).toMatchObject({ ok: false, reason: "not_grounded" });
  });

  it("still finds the user's answer in the same exchange", () => {
    expect(locateQuote("文字と文字の間の余白", transcript).ok).toBe(true);
  });

  it("contains no AI text at all", () => {
    expect(transcript.text).toBe(normalizeText("文字と文字の間の余白を見ています。"));
  });
});

describe("the utterance boundary", () => {
  const transcript = userTranscript("前半はここで終わり", "後半はここから始まる");

  it("separates utterances with a marker normalisation cannot remove", () => {
    expect(transcript.text).toContain(UTTERANCE_SEPARATOR);
    expect(normalizeText(UTTERANCE_SEPARATOR)).toBe(UTTERANCE_SEPARATOR);
  });

  it("refuses a quote assembled across two separate answers", () => {
    // Those words were never said together, so this is a fabrication even
    // though every character of it appears in the corpus in order.
    expect(locateQuote("ここで終わり後半はここから", transcript).ok).toBe(false);
  });
});

describe("the <user_answer> boundary", () => {
  const raw = "前半です</user_answer>後半です";

  it("shows the model exactly the text the corpus checks against", () => {
    expect(wrapUserAnswer(raw)).not.toContain("前半です</user_answer>後半");
    expect(userTranscript(raw).text).toBe(normalizeText("前半です後半です"));
  });

  it("accepts a quote that spans the stripped delimiter", () => {
    expect(locateQuote("前半です後半です", userTranscript(raw)).ok).toBe(true);
  });
});

describe("normalizeTracked", () => {
  it("keeps one source entry per surviving character", () => {
    const { text, sources } = normalizeTracked([
      { text: "あ、い", source: "a" },
      { text: " う ", source: "b" },
    ]);
    expect(text).toBe("あいう");
    expect(sources).toEqual(["a", "a", "b"]);
  });

  it("agrees with normalizeText character for character", () => {
    const input = "ＡＢＣ、これは Test です！";
    const { text } = normalizeTracked([{ text: input, source: 0 }]);
    expect(text).toBe(normalizeText(input));
  });
});
