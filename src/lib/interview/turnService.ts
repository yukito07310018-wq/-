import { runAnalystCall } from "../ai/analystCall";
import { runInterviewerCall, runReplyCall } from "../ai/interviewerCall";
import { selectContextElements } from "../ai/prompts";
import { aggregateAxes, diagnosisConfidence, overallCoverage } from "../engine/aggregation";
import { pickFallbackQuestion } from "../engine/fallbackQuestions";
import { computeProgress } from "../engine/progress";
import { selectQuestion } from "../engine/questionSelector";
import { evaluateTermination, MAX_TURNS } from "../engine/terminationEngine";
import { applyTurn } from "../engine/turnUpdate";
import { checkDistress, buildCrisisReply, DISTRESS_BANNED_PROBE_KINDS } from "../safety/distressCheck";
import * as repo from "../db/repository";
import type { AskedQuestion, QuestionCandidate } from "../types/diagnosis";

/**
 * One interview turn, end to end (§22).
 *
 * Order matters and is not negotiable: safety check → evidence → score →
 * confidence → contradictions → axes → termination → next question. Every
 * numeric step in the middle is a pure function; only the two ends touch the LLM.
 */

export interface TurnOutcome {
  reply: string;
  turn: number;
  progress: number;
  isComplete: boolean;
  resultUrl: string | null;
  aborted: boolean;
}

export async function processTurn(sessionId: string, message: string): Promise<TurnOutcome> {
  const session = await repo.getSession(sessionId);
  if (!session) throw new SessionNotFoundError();

  const turn = session.turnCount + 1;

  const [states, priorEvidence, priorContradictions, askedQuestions, conversation, confidenceHistory] =
    await Promise.all([
      repo.loadElementStates(sessionId),
      repo.loadEvidence(sessionId),
      repo.loadContradictions(sessionId),
      repo.loadAskedQuestions(sessionId),
      repo.loadConversation(sessionId),
      repo.loadMeanConfidenceHistory(sessionId),
    ]);

  await repo.saveConversationTurn(sessionId, turn, "user", message);

  // --- safety gate (§34.2) — before any extraction --------------------------
  const distress = await checkDistress(message);
  if (distress.level === "crisis") {
    const reply = buildCrisisReply();
    await repo.saveConversationTurn(sessionId, turn, "assistant", reply);
    await repo.setSessionStatus(sessionId, "aborted");
    return {
      reply,
      turn,
      progress: computeProgress({
        turn,
        meanConfidence: diagnosisConfidence(states),
        overallCoverage: overallCoverage(aggregateAxes(states)),
      }),
      isComplete: false,
      resultUrl: null,
      aborted: true,
    };
  }

  const lastQuestion = askedQuestions[askedQuestions.length - 1];
  const lastQuestionText = lastQuestion?.text ?? "";
  const recentlyUpdated = [...states.values()]
    .filter((s) => s.last_updated_turn >= turn - 3 && s.evidence_count > 0)
    .map((s) => s.element_id);

  // --- Call A: evidence extraction (§22-3) ----------------------------------
  let analyst;
  try {
    const elementIds = selectContextElements({
      states,
      contradictions: priorContradictions,
      recentlyUpdated,
      targetElements: lastQuestion?.target_elements,
    });

    console.info(
      `[turnService] analyst context: turn=${turn}, selectedElements=${elementIds.length}, ` +
      `targetElements=${lastQuestion?.target_elements?.length ?? 0}, ` +
      `hasQuestion=${!!lastQuestionText}`
    );
    if (elementIds.length > 0) {
      console.info(`[turnService] selected element IDs: ${elementIds.slice(0, 10).join(", ")}${elementIds.length > 10 ? "..." : ""}`);
    }

    analyst = await runAnalystCall({
      question: lastQuestionText,
      answer: message,
      elementIds,
      conversation,
      recentEvidence: priorEvidence,
      contradictions: priorContradictions,
    });

    console.info(
      `[turnService] analyst returned: evidence=${analyst.evidence.length}, ` +
      `contradictions=${analyst.contradictionCandidates.length}, ` +
      `rejected=${analyst.rejectedCount}, repaired=${analyst.repaired}`
    );
  } catch (error) {
    // §36 failure handling: a failed extraction must not stop the conversation.
    console.error("[turnService] analyst call failed, continuing with zero evidence:", error);
    analyst = { evidence: [], contradictionCandidates: [], rejectedCount: 0, repaired: false };
  }

  // --- deterministic model update (§22-4〜9) --------------------------------
  const update = applyTurn({
    turn,
    states,
    priorEvidence,
    priorContradictions,
    drafts: analyst.evidence,
    semanticCandidates: analyst.contradictionCandidates,
    makeEvidenceId: (i) => `ev-${turn}-${i}`,
    makeContradictionId: (i) => `cx-${turn}-${i}`,
  });

  await repo.persistTurn({
    sessionId,
    turn,
    evidence: update.newEvidence,
    changedStates: update.changedStates,
    newContradictions: update.newContradictions,
    resolutions: update.resolutions,
    axes: update.axes,
  });

  const progress = computeProgress({
    turn,
    meanConfidence: update.meanConfidence,
    overallCoverage: update.coverage,
  });

  // --- termination (§33) -----------------------------------------------------
  const termination = evaluateTermination({
    turn,
    meanConfidence: update.meanConfidence,
    overallCoverage: update.coverage,
    unresolvedContradictions: update.unresolvedContradictions,
    meanConfidenceHistory: confidenceHistory,
  });

  if (termination.shouldComplete) {
    const reply = buildCompletionReply(termination.reason === "max_turns");
    await repo.saveConversationTurn(sessionId, turn, "assistant", reply);
    await repo.setSessionStatus(sessionId, "completed");
    return { reply, turn, progress, isComplete: true, resultUrl: `/result/${sessionId}`, aborted: false };
  }

  // --- Call B + selection (§22-12〜14) --------------------------------------
  const bannedKinds = distress.level === "distress" ? [...DISTRESS_BANNED_PROBE_KINDS] : [];
  const nextQuestion = await chooseNextQuestion({
    sessionId,
    turn,
    states: update.states,
    contradictions: update.contradictions,
    askedQuestions,
    conversation,
    bannedKinds,
  });

  // --- reply (§22-15) --------------------------------------------------------
  let reply: string;
  try {
    reply = await runReplyCall({
      answer: message,
      nextQuestion: nextQuestion.question.text,
      distress: distress.level === "distress",
    });
  } catch (error) {
    console.error("[turnService] reply call failed, sending question only:", error);
    reply = nextQuestion.question.text;
  }

  await repo.saveConversationTurn(sessionId, turn, "assistant", reply);
  await repo.saveAskedQuestion(sessionId, {
    turn,
    text: nextQuestion.question.text,
    target_elements: nextQuestion.question.target_elements,
    probe_kind: nextQuestion.question.probe_kind,
    q_value: nextQuestion.qValue,
  });

  return { reply, turn, progress, isComplete: false, resultUrl: null, aborted: false };
}

interface ChooseQuestionInput {
  sessionId: string;
  turn: number;
  states: ReadonlyMap<string, import("../types/diagnosis").ElementState>;
  contradictions: readonly import("../types/diagnosis").Contradiction[];
  askedQuestions: readonly AskedQuestion[];
  conversation: readonly import("../db/repository").ConversationMessage[];
  bannedKinds: readonly string[];
}

/**
 * Generates candidates and picks one by QValue. Call B is retried once when
 * every candidate is a near-duplicate; after that a pre-authored fallback is
 * used so the interview always has something to ask (§17).
 */
async function chooseNextQuestion(
  input: ChooseQuestionInput
): Promise<{ question: QuestionCandidate; qValue: number }> {
  const ctx = {
    states: input.states,
    contradictions: input.contradictions,
    askedQuestions: input.askedQuestions,
  };

  const recentlyUpdated = [...input.states.values()]
    .filter((s) => s.evidence_count > 0)
    .map((s) => s.element_id);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const candidates = await runInterviewerCall(
        {
          elementIds: selectContextElements({
            states: input.states,
            contradictions: input.contradictions,
            recentlyUpdated,
          }),
          states: input.states,
          conversation: input.conversation,
          contradictions: input.contradictions,
          askedQuestions: input.askedQuestions,
          avoidProbeKinds: input.bannedKinds,
        },
        input.turn
      );

      const selection = selectQuestion(candidates, ctx);
      if (selection.selected) {
        return { question: selection.selected, qValue: selection.qValue };
      }
      console.warn(`[turnService] all candidates excluded as duplicates (attempt ${attempt + 1})`);
    } catch (error) {
      console.error(`[turnService] interviewer call failed (attempt ${attempt + 1}):`, error);
    }
  }

  const fallback = pickFallbackQuestion(input.askedQuestions, input.states, input.bannedKinds);
  if (fallback) return { question: fallback, qValue: 0 };

  // Every fallback used too: ask the user to expand rather than repeat verbatim.
  return {
    question: {
      question_id: `open-${input.turn}`,
      text: "ここまでのお話の中で、まだ話していないけれど自分にとって大きかった出来事はありますか。",
      target_elements: ["E010", "E090"],
      probe_kind: "experience",
      expected_yield: 0.5,
      rationale: "exhausted fallback set",
    },
    qValue: 0,
  };
}

function buildCompletionReply(reachedMaxTurns: boolean): string {
  const head = reachedMaxTurns
    ? "ここまでの対話で、十分な量の材料が集まりました。"
    : "ここまでの対話で、モデルを組み立てるのに十分な材料が集まりました。";
  return [
    head,
    "",
    "結果画面では、10軸それぞれの傾向と、その根拠になった発言を確認できます。",
    "確からしさ（confidence）が低い軸は「情報不足」として表示されます。今回の対話の範囲では判断材料が足りない、という意味です。",
  ].join("\n");
}

export class SessionNotFoundError extends Error {
  constructor() {
    super("session not found");
    this.name = "SessionNotFoundError";
  }
}

export const MAX_INTERVIEW_TURNS = MAX_TURNS;
