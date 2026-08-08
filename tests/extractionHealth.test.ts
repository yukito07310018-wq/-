import { describe, expect, it } from "vitest";
import {
  assessExtraction,
  describeExtraction,
  describeExtractionForOperator,
  DEGRADED_WINDOW,
} from "@/lib/engine/extractionHealth";
import type { TurnDiagnosticRecord } from "@/lib/db/repository";

/**
 * §36 — the whole point of this module: zero evidence has several causes and
 * they must not look alike. Every LLM call is fail-soft, so an outage and a
 * thin conversation both end at "情報不足" unless something separates them.
 */

function turn(overrides: Partial<TurnDiagnosticRecord> = {}): TurnDiagnosticRecord {
  return {
    turn: 1,
    analystOk: true,
    analystError: null,
    extracted: 3,
    accepted: 3,
    rejected: 0,
    rejectedReasons: {},
    repaired: false,
    droppedByLimits: 0,
    questionSource: "llm",
    ...overrides,
  };
}

describe("assessExtraction", () => {
  it("reports no_data before any turn is processed", () => {
    const health = assessExtraction([]);
    expect(health.status).toBe("no_data");
    expect(describeExtraction(health)).toBeNull();
  });

  it("reports ok while evidence is being accepted", () => {
    const health = assessExtraction([turn({ turn: 1 }), turn({ turn: 2 }), turn({ turn: 3 })]);
    expect(health.status).toBe("ok");
    expect(health.totalAccepted).toBe(9);
    expect(health.degraded).toBe(false);
    expect(describeExtraction(health)).toBeNull();
  });

  /** The production symptom: 5 turns, 0 evidence, because Call A never returned. */
  it("identifies an analyst outage rather than blaming the conversation", () => {
    const diagnostics = [1, 2, 3, 4, 5].map((t) =>
      turn({
        turn: t,
        analystOk: false,
        analystError: "AiUnavailableError: AI への接続に失敗しました。",
        extracted: 0,
        accepted: 0,
        questionSource: "fallback",
      })
    );

    const health = assessExtraction(diagnostics);
    expect(health.status).toBe("analyst_down");
    expect(health.analystFailures).toBe(5);
    expect(health.nonLlmQuestions).toBe(5);
    expect(health.degraded).toBe(true);
    expect(describeExtraction(health)).toContain("システム側の不具合");
    // The reader of the result screen cannot change configuration; never name it at them.
    expect(describeExtraction(health)).not.toMatch(/ANTHROPIC|APIキー|環境変数/);
    expect(describeExtractionForOperator(health)).toContain("/api/health");
  });

  /** Same zero result, different cause: the model answered but fabricated quotes. */
  it("distinguishes ungrounded quotes from an outage", () => {
    const diagnostics = [1, 2, 3].map((t) =>
      turn({
        turn: t,
        extracted: 3,
        accepted: 0,
        rejected: 3,
        rejectedReasons: { not_grounded: 3 },
      })
    );

    const health = assessExtraction(diagnostics);
    expect(health.status).toBe("quotes_ungrounded");
    expect(health.analystFailures).toBe(0);
    expect(health.totalRejected).toBe(9);
    expect(health.rejectedReasons.not_grounded).toBe(9);
    expect(describeExtraction(health)).toContain("あなたの回答に問題があったわけではありません");
    expect(describeExtractionForOperator(health)).toContain("引用");
  });

  /** And the case that is genuinely the answers, not the system. */
  it("attributes an empty extraction with no rejections to the answers", () => {
    const diagnostics = [1, 2, 3].map((t) => turn({ turn: t, extracted: 0, accepted: 0 }));
    const health = assessExtraction(diagnostics);
    expect(health.status).toBe("sparse_answers");
    // The one case that genuinely is about the answers — so it stays actionable.
    expect(describeExtraction(health)).toContain("いつ・何をした");
  });

  /** The warning must not fire on turn 1 just because history is short. */
  it("does not warn on the very first thin answer", () => {
    const health = assessExtraction([turn({ turn: 1, extracted: 0, accepted: 0 })]);
    expect(health.degraded).toBe(false);
  });

  it("warns once a second turn also fails", () => {
    const health = assessExtraction([
      turn({ turn: 1, extracted: 0, accepted: 0 }),
      turn({ turn: 2, extracted: 0, accepted: 0 }),
    ]);
    expect(health.degraded).toBe(true);
  });

  it("does not call a single bad turn degraded", () => {
    const diagnostics = [
      turn({ turn: 1 }),
      turn({ turn: 2 }),
      turn({ turn: 3, accepted: 0, extracted: 0 }),
    ];
    const health = assessExtraction(diagnostics);
    expect(health.degraded).toBe(false);
    expect(health.status).toBe("ok");
  });

  it("flags degradation once the recent window keeps failing", () => {
    const diagnostics = [
      turn({ turn: 1 }),
      turn({ turn: 2 }),
      turn({ turn: 3, accepted: 0, extracted: 0 }),
      turn({ turn: 4, accepted: 0, extracted: 0 }),
    ];
    const health = assessExtraction(diagnostics);
    expect(health.degraded).toBe(true);
    // Earlier evidence exists, so this is not "ok" despite totalAccepted > 0.
    expect(health.status).not.toBe("ok");
  });

  it("only looks at the recent window when judging degradation", () => {
    const failing = [1, 2, 3].map((t) => turn({ turn: t, accepted: 0, extracted: 0 }));
    const recovered = [4, 5, 6].map((t) => turn({ turn: t }));
    expect(DEGRADED_WINDOW).toBe(3);

    const health = assessExtraction([...failing, ...recovered]);
    expect(health.degraded).toBe(false);
    expect(health.status).toBe("ok");
  });

  it("sums repairs and limit drops across turns", () => {
    const health = assessExtraction([
      turn({ turn: 1, repaired: true, droppedByLimits: 2 }),
      turn({ turn: 2, repaired: true }),
      turn({ turn: 3 }),
    ]);
    expect(health.repairedTurns).toBe(2);
    expect(health.turnsRecorded).toBe(3);
  });
});
