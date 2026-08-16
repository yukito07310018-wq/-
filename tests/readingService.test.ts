import { describe, expect, it } from "vitest";
import { runReading, type ReadingPorts } from "@/lib/interview/readingService";
import { ModelOutputTruncatedError } from "@/lib/ai/client";
import { MIN_TURNS_FOR_READING } from "@/lib/engine/terminationEngine";
import { ReadingExtractionSchema } from "@/lib/validation/schemas";
import type { Reading, ReadingSegment } from "@/lib/types/reading";
import type { ConversationMessage, SessionRecord } from "@/lib/db/repository";

/**
 * When the model is called, and — more to the point — when it is not.
 *
 * Reading is the one expensive thing this app does and the only thing it
 * produces, so both guards in front of it are load-bearing: a session with a
 * stored reading must never be read twice, and a session too short to say
 * anything about must never be read at all.
 */

const SESSION_ID = "sess-1";

interface Harness {
  ports: ReadingPorts;
  /** Every port that ran, in order — the model call included. */
  calls: string[];
  saved: Reading[];
}

function harness(options: {
  turnCount: number;
  stored?: Reading | null;
  segments?: ReadingSegment[];
  readFails?: Error;
  session?: SessionRecord | null;
}): Harness {
  const calls: string[] = [];
  const saved: Reading[] = [];

  const conversation: ConversationMessage[] = [
    { turnIndex: 1, role: "user", content: "最初に話したことです" },
  ];

  const session: SessionRecord | null =
    options.session === undefined
      ? { id: SESSION_ID, status: "completed", processing: false, turnCount: options.turnCount }
      : options.session;

  return {
    calls,
    saved,
    ports: {
      getSession: async () => {
        calls.push("getSession");
        return session;
      },
      loadReading: async () => {
        calls.push("loadReading");
        return options.stored ?? null;
      },
      saveReading: async (reading) => {
        calls.push("saveReading");
        saved.push(reading);
      },
      loadConversation: async () => {
        calls.push("loadConversation");
        return conversation;
      },
      readConversation: async () => {
        calls.push("readConversation");
        if (options.readFails) throw options.readFails;
        return options.segments ?? [];
      },
    },
  };
}

const storedReading: Reading = {
  session_id: SESSION_ID,
  turn_count: 7,
  topics: [
    {
      element_id: "E051",
      returns: 2,
      first_turn: 1,
      quotes: [{ text: "保存済みの言葉", turn: 1 }],
    },
  ],
};

describe("a session too short to read", () => {
  it("does not call the model below the floor", async () => {
    for (let turnCount = 0; turnCount < MIN_TURNS_FOR_READING; turnCount++) {
      const h = harness({ turnCount });
      const outcome = await runReading(SESSION_ID, h.ports);

      expect(outcome, `turnCount ${turnCount}`).toMatchObject({
        status: "too_short",
        turnCount,
        required: MIN_TURNS_FOR_READING,
      });
      expect(h.calls, `turnCount ${turnCount}`).not.toContain("readConversation");
      expect(h.saved).toHaveLength(0);
    }
  });

  it("does not even load the conversation it is not going to read", async () => {
    const h = harness({ turnCount: 1 });
    await runReading(SESSION_ID, h.ports);
    expect(h.calls).toEqual(["getSession", "loadReading"]);
  });

  it("reads a session that reaches the floor", async () => {
    const h = harness({
      turnCount: MIN_TURNS_FOR_READING,
      segments: [
        { from_turn: 1, to_turn: 3, element_id: "E051", quotes: [{ text: "言葉", turn: 1 }] },
      ],
    });
    const outcome = await runReading(SESSION_ID, h.ports);

    expect(outcome.status).toBe("ready");
    expect(h.calls).toContain("readConversation");
  });
});

describe("a session already read", () => {
  it("returns the stored reading without calling the model", async () => {
    const h = harness({ turnCount: 7, stored: storedReading });
    const outcome = await runReading(SESSION_ID, h.ports);

    expect(outcome).toEqual({ status: "ready", reading: storedReading });
    expect(h.calls).not.toContain("readConversation");
    expect(h.calls).not.toContain("loadConversation");
    expect(h.saved).toHaveLength(0);
  });

  it("gives the same answer however many times the page is opened", async () => {
    const h = harness({ turnCount: 7, stored: storedReading });
    const first = await runReading(SESSION_ID, h.ports);
    const second = await runReading(SESSION_ID, h.ports);
    const third = await runReading(SESSION_ID, h.ports);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(h.calls.filter((c) => c === "readConversation")).toHaveLength(0);
  });

  it("checks for a stored reading before anything else", async () => {
    const h = harness({ turnCount: 1, stored: storedReading });
    // Short *and* already read: the stored reading wins, so a session read
    // before the floor moved is not retracted by moving it.
    expect(await runReading(SESSION_ID, h.ports)).toMatchObject({ status: "ready" });
  });
});

describe("a session the safety gate stopped", () => {
  it("is never read, however the result page is reached", async () => {
    // §9.2: after a crisis the interview screen hides its own controls, but
    // /result/:id is a plain URL and the guard has to hold there too.
    const h = harness({
      turnCount: 8,
      session: { id: SESSION_ID, status: "aborted", processing: false, turnCount: 8 },
    });
    const outcome = await runReading(SESSION_ID, h.ports);

    expect(outcome).toEqual({ status: "aborted" });
    expect(h.calls).toEqual(["getSession"]);
    expect(h.saved).toHaveLength(0);
  });
});

describe("a session read for the first time", () => {
  it("stores what it read", async () => {
    const h = harness({
      turnCount: 6,
      segments: [
        { from_turn: 1, to_turn: 3, element_id: "E051", quotes: [{ text: "一度目", turn: 1 }] },
        { from_turn: 4, to_turn: 5, element_id: "E020", quotes: [{ text: "よそ見", turn: 4 }] },
        { from_turn: 6, to_turn: 6, element_id: "E051", quotes: [{ text: "二度目", turn: 6 }] },
      ],
    });
    const outcome = await runReading(SESSION_ID, h.ports);

    expect(outcome.status).toBe("ready");
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].turn_count).toBe(6);
    expect(h.saved[0].topics.find((t) => t.element_id === "E051")!.returns).toBe(2);
  });

  it("reports a missing session rather than reading one", async () => {
    const h = harness({ turnCount: 6, session: null });
    expect(await runReading(SESSION_ID, h.ports)).toEqual({ status: "not_found" });
    expect(h.calls).toEqual(["getSession"]);
  });
});

describe("the reader's output schema", () => {
  const base = { from_turn: 1, to_turn: 2, quotes: ["言葉"] };

  it("keeps an element the model actually has", () => {
    const parsed = ReadingExtractionSchema.parse({
      segments: [{ ...base, element_id: "E051" }],
    });
    expect(parsed.segments[0].element_id).toBe("E051");
  });

  it("turns an id that does not exist into 該当なし rather than failing", () => {
    // One bad label costs that segment its name, not the session its reading.
    for (const bad of ["E999", "余白への感度", "", 42, undefined]) {
      const parsed = ReadingExtractionSchema.parse({
        segments: [{ ...base, element_id: bad }],
      });
      expect(parsed.segments[0].element_id, String(bad)).toBeNull();
    }
  });

  it("accepts a segment the model found nothing quotable in", () => {
    const parsed = ReadingExtractionSchema.parse({
      segments: [{ from_turn: 1, to_turn: 2, element_id: "E051" }],
    });
    expect(parsed.segments[0].quotes).toEqual([]);
  });
});

describe("when the reading fails", () => {
  it("says the output was cut off rather than reporting an empty reading", async () => {
    // The old failure: a truncated reply parsed as nothing, was caught, and the
    // turn reported success with zero evidence.
    const h = harness({
      turnCount: 6,
      readFails: new ModelOutputTruncatedError("reader", 4000),
    });
    const outcome = await runReading(SESSION_ID, h.ports);

    expect(outcome.status).toBe("truncated");
    expect(outcome).toHaveProperty("message", expect.stringContaining("4000"));
  });

  it("stores nothing, so opening the page again retries", async () => {
    const h = harness({ turnCount: 6, readFails: new Error("network") });
    const outcome = await runReading(SESSION_ID, h.ports);

    expect(outcome.status).toBe("failed");
    expect(h.saved).toHaveLength(0);
  });
});
