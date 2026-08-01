import { describe, expect, it } from "vitest";
import questionFixture from "./fixtures/questionCandidates.json";
import { QuestionGenerationSchema } from "@/lib/validation/schemas";
import {
  contradictionTerm,
  diversityTerm,
  evidenceImportanceTerm,
  informationGainTerm,
  scoreCandidate,
  selectQuestion,
  uncertaintyTerm,
} from "@/lib/engine/questionSelector";
import { pickFallbackQuestion, pickOpeningQuestion } from "@/lib/engine/fallbackQuestions";
import { ELEMENT_IDS } from "@/lib/model/elements";
import { makeState, uniformStates } from "./helpers";
import type { AskedQuestion, Contradiction, QuestionCandidate } from "@/lib/types/diagnosis";

/** §17 — the selector, not the LLM, decides what gets asked. */

function candidate(overrides: Partial<QuestionCandidate> & { question_id: string }): QuestionCandidate {
  return {
    text: `質問${overrides.question_id}：具体的な経験を教えてください`,
    target_elements: ["E001"],
    probe_kind: "experience",
    expected_yield: 0.7,
    rationale: "",
    ...overrides,
  };
}

const baseStates = uniformStates(ELEMENT_IDS);

describe("Call B fixture", () => {
  it("passes schema validation and yields 3 candidates", () => {
    const parsed = QuestionGenerationSchema.parse(questionFixture);
    expect(parsed.questions).toHaveLength(3);
  });
});

describe("individual terms", () => {
  it("U is highest for unmeasured elements", () => {
    const states = new Map(baseStates);
    states.set("E002", makeState({ element_id: "E002", confidence: 0.9 }));
    const ctx = { states, contradictions: [], askedQuestions: [] };

    expect(uncertaintyTerm(["E001"], ctx)).toBeCloseTo(1, 10);
    expect(uncertaintyTerm(["E002"], ctx)).toBeCloseTo(0.1, 10);
  });

  it("I scales with expected yield", () => {
    const ctx = { states: baseStates, contradictions: [], askedQuestions: [] };
    expect(informationGainTerm(["E001"], 0.9, ctx)).toBeGreaterThan(
      informationGainTerm(["E001"], 0.2, ctx)
    );
  });

  it("C is the severity of the worst relevant unresolved contradiction", () => {
    const contradictions: Contradiction[] = [
      {
        contradiction_id: "c1",
        elements: ["E001"],
        evidence_a: "a",
        evidence_b: "b",
        severity: 0.9,
        status: "unresolved",
        detected_turn: 2,
      },
      {
        contradiction_id: "c2",
        elements: ["E002"],
        evidence_a: "c",
        evidence_b: "d",
        severity: 0.6,
        status: "resolved",
        detected_turn: 3,
      },
    ];
    const ctx = { states: baseStates, contradictions, askedQuestions: [] };

    expect(contradictionTerm(["E001"], ctx)).toBeCloseTo(0.9, 10);
    expect(contradictionTerm(["E002"], ctx)).toBe(0); // resolved does not count
    expect(contradictionTerm(["E003"], ctx)).toBe(0);
  });

  it("D penalises repeating the recent axis and probe kind", () => {
    const asked: AskedQuestion[] = [1, 2, 3].map((turn) => ({
      turn,
      text: `過去の質問${turn}`,
      target_elements: ["E001"], // AX01
      probe_kind: "experience",
      q_value: 0.5,
    }));
    const ctx = { states: baseStates, contradictions: [], askedQuestions: asked };

    const repeat = diversityTerm(candidate({ question_id: "r" }), ctx);
    const fresh = diversityTerm(
      candidate({ question_id: "f", target_elements: ["E091"], probe_kind: "future" }),
      ctx
    );

    expect(repeat).toBeCloseTo(0, 10);
    expect(fresh).toBeCloseTo(1, 10);
  });

  it("E favours elements with no evidence at all", () => {
    const states = new Map(baseStates);
    states.set("E002", makeState({ element_id: "E002", evidence_count: 4 }));
    const ctx = { states, contradictions: [], askedQuestions: [] };

    expect(evidenceImportanceTerm(["E001"], ctx)).toBeGreaterThan(
      evidenceImportanceTerm(["E002"], ctx)
    );
  });
});

describe("selectQuestion", () => {
  it("prefers the candidate aimed at the least certain elements", () => {
    const states = new Map(baseStates);
    states.set("E002", makeState({ element_id: "E002", confidence: 0.95, evidence_count: 6 }));

    const result = selectQuestion(
      [
        candidate({ question_id: "known", target_elements: ["E002"] }),
        candidate({ question_id: "unknown", target_elements: ["E001"] }),
      ],
      { states, contradictions: [], askedQuestions: [] }
    );

    expect(result.selected?.question_id).toBe("unknown");
  });

  it("prefers a candidate that addresses an unresolved contradiction", () => {
    // Both targets are equally unmeasured; only the contradiction differs.
    const contradictions: Contradiction[] = [
      {
        contradiction_id: "c1",
        elements: ["E003"],
        evidence_a: "a",
        evidence_b: "b",
        severity: 0.9,
        status: "unresolved",
        detected_turn: 1,
      },
    ];

    const result = selectQuestion(
      [
        candidate({ question_id: "plain", target_elements: ["E004"] }),
        candidate({ question_id: "resolving", target_elements: ["E003"] }),
      ],
      { states: baseStates, contradictions, askedQuestions: [] }
    );

    expect(result.selected?.question_id).toBe("resolving");
    const breakdown = result.breakdowns.find((b) => b.question_id === "resolving")!;
    expect(breakdown.contradiction_relevance).toBeCloseTo(0.9, 10);
  });

  it("keeps QValue inside 0..1", () => {
    const breakdown = scoreCandidate(candidate({ question_id: "q", expected_yield: 1 }), {
      states: baseStates,
      contradictions: [],
      askedQuestions: [],
    });
    expect(breakdown.q_value).toBeGreaterThan(0);
    expect(breakdown.q_value).toBeLessThanOrEqual(1);
  });
});

describe("fallbacks (§17/§24)", () => {
  it("provides a broad opening question", () => {
    const opening = pickOpeningQuestion();
    expect(opening.text.length).toBeGreaterThan(0);
    expect([...opening.text].length).toBeLessThanOrEqual(120);
  });

  it("returns an unused fallback and skips asked ones", () => {
    const first = pickFallbackQuestion([], baseStates)!;
    const asked: AskedQuestion[] = [
      {
        turn: 1,
        text: first.text,
        target_elements: first.target_elements,
        probe_kind: first.probe_kind,
        q_value: 0,
      },
    ];
    const second = pickFallbackQuestion(asked, baseStates)!;
    expect(second.question_id).not.toBe(first.question_id);
  });

  it("respects banned probe kinds", () => {
    const picked = pickFallbackQuestion([], baseStates, ["failure", "conflict"]);
    expect(picked).not.toBeNull();
    expect(["failure", "conflict"]).not.toContain(picked!.probe_kind);
  });
});
