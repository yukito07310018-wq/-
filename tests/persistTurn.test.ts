import { beforeEach, describe, expect, it, vi } from "vitest";
import { AXES } from "@/lib/model/axes";
import { ELEMENT_IDS } from "@/lib/model/elements";
import { MAX_ELEMENTS_PER_TURN, MAX_EVIDENCE_PER_TURN } from "@/lib/engine/scoreEngine";
import { makeState } from "./helpers";
import type { AxisAggregate, Contradiction, ElementState, Evidence } from "@/lib/types/diagnosis";

/**
 * §27 — persistTurn writes one turn atomically.
 *
 * The regression guarded here is a production outage: persistTurn used to await
 * one statement at a time inside an interactive transaction, so a turn cost ~33
 * sequential round trips. Against a hosted database that exceeded Prisma's
 * transaction budget, the write aborted with P2028, and the API turned that into
 * a generic INTERNAL error — the user lost the answer they had just written.
 *
 * These tests assert the shape that prevents it: the number of statements must
 * be bounded by a small constant and must not grow with the number of evidence
 * items, score histories or axes in the turn.
 */

/* -------------------------------------------------------------------------- */
/* A Prisma double that records the batch it is handed                        */
/* -------------------------------------------------------------------------- */

interface RecordedOp {
  model: string;
  action: string;
  rows: number;
  /** The full call arguments, so assertions can inspect what was written. */
  args: unknown;
}

let ops: RecordedOp[] = [];
let batches: RecordedOp[][] = [];
let interactiveTransactions = 0;

function op(model: string, action: string) {
  return (args: { data?: unknown } = {}) => {
    const data = args.data;
    const recorded: RecordedOp = {
      model,
      action,
      rows: Array.isArray(data) ? data.length : 1,
      args,
    };
    ops.push(recorded);
    return recorded;
  };
}

function model(name: string) {
  return {
    create: op(name, "create"),
    createMany: op(name, "createMany"),
    update: op(name, "update"),
    upsert: op(name, "upsert"),
    updateMany: op(name, "updateMany"),
    findMany: vi.fn(async () =>
      ELEMENT_IDS.map((elementId) => ({ id: `state-${elementId}`, elementId }))
    ),
  };
}

vi.mock("@/lib/db/prisma", () => {
  const prisma = {
    session: model("session"),
    elementState: model("elementState"),
    evidence: model("evidence"),
    scoreHistory: model("scoreHistory"),
    contradiction: model("contradiction"),
    axisSnapshot: model("axisSnapshot"),
    $transaction: async (arg: unknown) => {
      if (typeof arg === "function") {
        // An interactive transaction is exactly what must not come back.
        interactiveTransactions += 1;
        return (arg as (tx: unknown) => unknown)(prisma);
      }
      batches.push([...(arg as RecordedOp[])]);
      return arg;
    },
  };
  return { prisma };
});

const { persistTurn } = await import("@/lib/db/repository");

/* -------------------------------------------------------------------------- */
/* Builders                                                                    */
/* -------------------------------------------------------------------------- */

function evidenceItem(index: number, elementId: string): Evidence {
  return {
    evidence_id: `ev-1-${index}`,
    turn_id: 1,
    element_id: elementId,
    quote: "テスト用の引用テキストです",
    type: "personal_experience",
    strength: 0.8,
    reliability: 0.8,
    direction: "positive",
    context: "テスト用。",
  };
}

function changedState(elementId: string, causeIds: string[]): ElementState {
  return makeState({
    element_id: elementId,
    evidence_count: 1,
    last_updated_turn: 1,
    history: [{ turn: 1, score: 60, confidence: 0.3, delta: 10, cause_evidence_ids: causeIds }],
  });
}

function axes(): AxisAggregate[] {
  return AXES.map((a) => ({
    axis_id: a.axis_id,
    name: a.name,
    score: 50,
    confidence: 0.2,
    coverage: 0.1,
  }));
}

/** A turn at the §9.2 intake ceiling: the largest one the engine can produce. */
function maximalTurn() {
  const elements = ELEMENT_IDS.slice(0, MAX_ELEMENTS_PER_TURN);
  const evidence = Array.from({ length: MAX_EVIDENCE_PER_TURN }, (_, i) =>
    evidenceItem(i, elements[i % elements.length])
  );
  const changedStates = new Map<string, ElementState>(
    elements.map((id, i) => [id, changedState(id, [`ev-1-${i}`])])
  );
  return { evidence, changedStates };
}

beforeEach(() => {
  ops = [];
  batches = [];
  interactiveTransactions = 0;
});

/* -------------------------------------------------------------------------- */

describe("persistTurn round-trip cost", () => {
  it("does not use an interactive transaction", async () => {
    const { evidence, changedStates } = maximalTurn();
    await persistTurn({
      sessionId: "s1",
      turn: 1,
      evidence,
      changedStates,
      newContradictions: [],
      resolutions: [],
      axes: axes(),
    });

    expect(interactiveTransactions).toBe(0);
    expect(batches).toHaveLength(1);
  });

  it("collapses 8 evidence rows into a single statement", async () => {
    const { evidence, changedStates } = maximalTurn();
    await persistTurn({
      sessionId: "s1",
      turn: 1,
      evidence,
      changedStates,
      newContradictions: [],
      resolutions: [],
      axes: axes(),
    });

    const evidenceOps = ops.filter((o) => o.model === "evidence");
    expect(evidenceOps).toHaveLength(1);
    expect(evidenceOps[0].action).toBe("createMany");
    expect(evidenceOps[0].rows).toBe(MAX_EVIDENCE_PER_TURN);
  });

  it("writes all ten axis snapshots in a single statement", async () => {
    const { evidence, changedStates } = maximalTurn();
    await persistTurn({
      sessionId: "s1",
      turn: 1,
      evidence,
      changedStates,
      newContradictions: [],
      resolutions: [],
      axes: axes(),
    });

    const axisOps = ops.filter((o) => o.model === "axisSnapshot");
    expect(axisOps).toHaveLength(1);
    expect(axisOps[0].rows).toBe(10);
  });

  it("keeps the largest possible turn well under a dozen statements", async () => {
    const { evidence, changedStates } = maximalTurn();
    const contradictions: Contradiction[] = [
      {
        contradiction_id: "cx-1-0",
        elements: [ELEMENT_IDS[0], ELEMENT_IDS[1]],
        evidence_a: "ev-1-0",
        evidence_b: "ev-1-1",
        severity: 0.5,
        status: "unresolved",
        detected_turn: 1,
      },
    ];

    await persistTurn({
      sessionId: "s1",
      turn: 1,
      evidence,
      changedStates,
      newContradictions: contradictions,
      resolutions: [{ contradiction_id: "cx-old", resolution_note: "解消" }],
      axes: axes(),
    });

    // 1 evidence + 6 state updates + 1 history + 1 contradiction + 1 resolution
    // + 1 axes + 1 session = 12. The old code issued 33 for the same turn.
    expect(batches[0].length).toBeLessThanOrEqual(12);
  });

  it("does not grow the statement count when more evidence arrives", async () => {
    const small = {
      sessionId: "s1",
      turn: 1,
      evidence: [evidenceItem(0, ELEMENT_IDS[0])],
      changedStates: new Map([[ELEMENT_IDS[0], changedState(ELEMENT_IDS[0], ["ev-1-0"])]]),
      newContradictions: [],
      resolutions: [],
      axes: axes(),
    };
    await persistTurn(small);
    const smallCount = batches[0].length;

    batches = [];
    ops = [];

    const { evidence, changedStates } = maximalTurn();
    await persistTurn({
      sessionId: "s1",
      turn: 1,
      evidence,
      changedStates,
      newContradictions: [],
      resolutions: [],
      axes: axes(),
    });
    const largeCount = batches[0].length;

    // Only the per-element updates scale, and they are capped at 6 by §9.2.
    expect(largeCount - smallCount).toBeLessThanOrEqual(MAX_ELEMENTS_PER_TURN);
  });
});

describe("provisional evidence ids", () => {
  it("rewrites cause_evidence_ids and contradiction sides onto the stored ids", async () => {
    const evidence = [evidenceItem(0, ELEMENT_IDS[0]), evidenceItem(1, ELEMENT_IDS[1])];
    const changedStates = new Map<string, ElementState>([
      [ELEMENT_IDS[0], changedState(ELEMENT_IDS[0], ["ev-1-0"])],
    ]);

    await persistTurn({
      sessionId: "s1",
      turn: 1,
      evidence,
      changedStates,
      newContradictions: [
        {
          contradiction_id: "cx-1-0",
          elements: [ELEMENT_IDS[0], ELEMENT_IDS[1]],
          evidence_a: "ev-1-0",
          evidence_b: "ev-1-1",
          severity: 0.5,
          status: "unresolved",
          detected_turn: 1,
        },
      ],
      resolutions: [],
      axes: axes(),
    });

    // Assert against the rows actually handed to Prisma. Provisional ids are
    // only unique within a turn, so any that survive would collide across turns.
    const evidenceRows = ops.find((o) => o.model === "evidence")!.args as {
      data: { id: string }[];
    };
    const storedIds = evidenceRows.data.map((r) => r.id);
    expect(storedIds).toHaveLength(2);
    for (const id of storedIds) expect(id).not.toMatch(/^ev-\d+-\d+$/);

    const historyRows = ops.find((o) => o.model === "scoreHistory")!.args as {
      data: { causeEvidenceIds: string }[];
    };
    // The cause list must point at the ids that were really stored.
    expect(JSON.parse(historyRows.data[0].causeEvidenceIds)).toEqual([storedIds[0]]);

    const contradictionRows = ops.find((o) => o.model === "contradiction")!.args as {
      data: { evidenceAId: string; evidenceBId: string }[];
    };
    expect(contradictionRows.data[0].evidenceAId).toBe(storedIds[0]);
    expect(contradictionRows.data[0].evidenceBId).toBe(storedIds[1]);
  });
});
