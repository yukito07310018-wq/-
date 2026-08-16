import { describe, expect, it } from "vitest";
import { mergeAdjacentSegments, summarizeTopics } from "@/lib/engine/returns";
import type { ReadingSegment } from "@/lib/types/reading";

/**
 * What counts as coming back to something.
 *
 * The distinction this file exists for: the interview holds one subject for up
 * to four turns, so turns spent on a topic without a break are the interview's
 * doing. Only leaving and returning is the person's.
 */

function segment(
  from: number,
  to: number,
  elementId: string | null,
  ...quotes: string[]
): ReadingSegment {
  return {
    from_turn: from,
    to_turn: to,
    element_id: elementId,
    quotes: quotes.map((text, i) => ({ text, turn: from + i })),
  };
}

describe("a run with no topic change counts once", () => {
  it("counts four turns on one subject as one visit", () => {
    const topics = summarizeTopics([segment(1, 4, "E051", "最初の言葉", "次の言葉")]);
    expect(topics).toHaveLength(1);
    expect(topics[0].returns).toBe(1);
  });

  it("counts a run the reading split in two as one visit", () => {
    // A model dividing a conversation sometimes cuts one stretch in half. That
    // is not the person leaving and coming back.
    const topics = summarizeTopics([
      segment(1, 2, "E051", "前半の言葉"),
      segment(3, 4, "E051", "後半の言葉"),
    ]);
    expect(topics).toHaveLength(1);
    expect(topics[0].returns).toBe(1);
    expect(topics[0].quotes.map((q) => q.text)).toEqual(["前半の言葉", "後半の言葉"]);
  });

  it("stays at one however long the run is", () => {
    const long = Array.from({ length: 8 }, (_, i) => segment(i + 1, i + 1, "E051", `言葉${i}`));
    expect(summarizeTopics(long)[0].returns).toBe(1);
  });
});

describe("a return across a topic change counts again", () => {
  it("counts two when the subject was left and picked back up", () => {
    const topics = summarizeTopics([
      segment(1, 4, "E051", "最初に話したこと"),
      segment(5, 8, "E020", "別の話題のこと"),
      segment(9, 10, "E051", "また戻ってきたこと"),
    ]);

    const returned = topics.find((t) => t.element_id === "E051")!;
    expect(returned.returns).toBe(2);
    expect(returned.quotes.map((q) => q.text)).toEqual(["最初に話したこと", "また戻ってきたこと"]);
    expect(topics.find((t) => t.element_id === "E020")!.returns).toBe(1);
  });

  it("counts three across two departures", () => {
    const topics = summarizeTopics([
      segment(1, 2, "E051", "一度目"),
      segment(3, 4, "E020", "よそ見"),
      segment(5, 6, "E051", "二度目"),
      segment(7, 8, "E030", "またよそ見"),
      segment(9, 10, "E051", "三度目"),
    ]);
    expect(topics.find((t) => t.element_id === "E051")!.returns).toBe(3);
  });

  it("keeps a departure that left no usable quotes as a separator", () => {
    // Everything the model claimed was said in the middle segment turned out
    // not to have been. The person still left the subject and came back.
    const topics = summarizeTopics([
      segment(1, 2, "E051", "一度目"),
      segment(3, 4, "E020"),
      segment(5, 6, "E051", "二度目"),
    ]);
    expect(topics).toHaveLength(1);
    expect(topics[0].returns).toBe(2);
  });
});

describe("topics with no element", () => {
  it("never accumulates two unnamed subjects into one", () => {
    // null means "none of the hundred fits", which is not an identity — two
    // unnameable subjects are two subjects, not one seen twice.
    const topics = summarizeTopics([
      segment(1, 2, null, "ひとつめ"),
      segment(3, 4, "E051", "あいだ"),
      segment(5, 6, null, "ふたつめ"),
    ]);
    expect(topics.filter((t) => t.element_id === null)).toHaveLength(2);
    for (const topic of topics) expect(topic.returns).toBe(1);
  });

  it("does not merge adjacent unnamed segments", () => {
    const merged = mergeAdjacentSegments([segment(1, 2, null, "a"), segment(3, 4, null, "b")]);
    expect(merged).toHaveLength(2);
  });
});

describe("ordering and pruning", () => {
  it("lists topics in the order the person first raised them", () => {
    const topics = summarizeTopics([
      segment(5, 6, "E020", "あとの話"),
      segment(1, 2, "E051", "さきの話"),
      segment(7, 8, "E051", "戻ってきた"),
    ]);
    expect(topics.map((t) => t.element_id)).toEqual(["E051", "E020"]);
  });

  it("drops a topic whose quotes all failed verification", () => {
    const topics = summarizeTopics([segment(1, 2, "E051", "本物"), segment(3, 4, "E020")]);
    expect(topics.map((t) => t.element_id)).toEqual(["E051"]);
  });

  it("returns nothing when no quote survived anywhere", () => {
    expect(summarizeTopics([segment(1, 2, "E051"), segment(3, 4, null)])).toEqual([]);
  });
});
