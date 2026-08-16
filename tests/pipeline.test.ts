import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The per-turn extraction is disconnected, and stays disconnected.
 *
 * `lib/engine/*` still computes Scores and Confidences, the tables still exist,
 * and the tests for both still pass — that was a deliberate decision, not an
 * oversight. The risk it carries is that "unwired" is invisible: one import and
 * one call would put the whole loop back, and nothing would fail. These two
 * tests are what fails.
 */

const h = vi.hoisted(() => ({
  calls: [] as string[],
  turnCount: 2,
}));

vi.mock("@/lib/db/repository", () => {
  const record =
    <A extends unknown[], R>(name: string, impl: (...args: A) => R) =>
    (...args: A): R => {
      h.calls.push(name);
      return impl(...args);
    };

  return {
    getSession: record("getSession", async () => ({
      id: "sess-1",
      status: "active",
      processing: false,
      turnCount: h.turnCount,
    })),
    loadAskedQuestions: record("loadAskedQuestions", async () => [
      {
        turn: 0,
        text: "最近、楽しかったことは何ですか。",
        target_elements: [],
        probe_kind: "decision" as const,
        mode: "opening" as const,
      },
    ]),
    loadConversation: record("loadConversation", async () => [
      { turnIndex: 0, role: "assistant" as const, content: "最近、楽しかったことは何ですか。" },
    ]),
    saveConversationTurn: record("saveConversationTurn", async () => {}),
    saveAskedQuestion: record("saveAskedQuestion", async () => {}),
    setTurnCount: record("setTurnCount", async () => {}),
    setSessionStatus: record("setSessionStatus", async () => {}),
    loadReading: record("loadReading", async () => null),
    saveReading: record("saveReading", async () => {}),
  };
});

vi.mock("@/lib/safety/distressCheck", () => ({
  checkDistress: async () => ({ level: "none" as const, reason: "" }),
  buildCrisisReply: () => "crisis",
  DISTRESS_BANNED_PROBE_KINDS: ["failure", "conflict"] as const,
}));

vi.mock("@/lib/ai/interviewerCall", () => ({
  runInterviewerCall: async () => ({
    signal: "normal" as const,
    candidates: [
      {
        question_id: "q-1-0",
        text: "そのとき、何が引っかかっていましたか。",
        target_elements: [],
        probe_kind: "experience" as const,
        expected_yield: 0.7,
        rationale: "",
      },
    ],
  }),
  runReplyCall: async () => "受け取りました。\n\nそのとき、何が引っかかっていましたか。",
}));

import { processTurn } from "@/lib/interview/turnService";

beforeEach(() => {
  h.calls = [];
  h.turnCount = 2;
});

describe("one turn touches nothing but the conversation", () => {
  it("calls exactly the reads and writes an interview turn needs", async () => {
    await processTurn("sess-1", "看板の余白のことを考えていました。");

    // Exact, not a subset: reconnecting extraction means adding a call here,
    // and adding a call here fails this assertion.
    expect([...new Set(h.calls)].sort()).toEqual([
      "getSession",
      "loadAskedQuestions",
      "loadConversation",
      "saveAskedQuestion",
      "saveConversationTurn",
      "setTurnCount",
    ]);
  });

  it("writes no evidence, no element state and no axis snapshot", async () => {
    await processTurn("sess-1", "看板の余白のことを考えていました。");

    for (const forbidden of ["persistTurn", "saveEvidence", "loadEvidence", "loadElementStates"]) {
      expect(h.calls, forbidden).not.toContain(forbidden);
    }
  });

  it("still runs the distress check before saving anything else", async () => {
    // §34.2 is not part of the extraction and was not removed with it.
    const distress = await import("@/lib/safety/distressCheck");
    expect(distress.checkDistress).toBeTypeOf("function");
  });
});

describe("the repository offers no route back to the extraction tables", () => {
  it("exports only what the interview and the reading use", async () => {
    const repo = await vi.importActual<Record<string, unknown>>("@/lib/db/repository");

    expect(Object.keys(repo).sort()).toEqual([
      "acquireSessionLock",
      "createSession",
      "deleteSession",
      "getSession",
      "loadAskedQuestions",
      "loadConversation",
      "loadReading",
      "releaseSessionLock",
      "saveAskedQuestion",
      "saveConversationTurn",
      "saveReading",
      "setSessionStatus",
      "setTurnCount",
    ]);
  });

  it("has no reader for ElementState, Evidence or AxisSnapshot", async () => {
    // The result page renders from `Reading` alone. If a reader for the scored
    // tables reappears, something is reading them again.
    const repo = await vi.importActual<Record<string, unknown>>("@/lib/db/repository");
    const names = Object.keys(repo).join(" ");

    expect(names).not.toMatch(/ElementState|Evidence|Contradiction|Snapshot|ScoreHistory/i);
  });
});
