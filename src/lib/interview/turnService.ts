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

/**
 * Wall clock the model calls of one turn may consume between them.
 *
 * The route is killed by the platform at `maxDuration` (300s), and a kill is
 * the worst way to end a turn: the response is not ours, so the client sees a
 * transport error instead of a message, and the `finally` that releases the
 * session lock never runs — leaving the session unusable until the lock's TTL
 * expires. Stopping first means the turn fails as an ordinary 503 that the user
 * can act on, with the lock released on the way out.
 *
 * Individual calls are still allowed to be slow (see CALL_BUDGET_MS); this only
 * bounds what they add up to.
 */
export const TURN_AI_BUDGET_MS = 240_000;

export async function processTurn(sessionId: string, message: string): Promise<TurnOutcome> {
  // Re-read rather than take the route's copy: the route loads the session
  // *before* claiming the lock, so between those two steps a concurrent turn can
  // commit and bump turnCount. Reading here — with the lock held — is the only
  // point at which the value is stable, and reusing a stale one would overwrite
  // an already-recorded turn.
  const session = await repo.getSession(sessionId);
  if (!session) throw new SessionNotFoundError();
  // Status is stale for the same reason: the turn that landed in between may
  // have been the one that completed or aborted the interview, and appending to
  // a finished session would push it past MAX_TURNS.
  if (session.status !== "active") throw new SessionClosedError();

  const deadline = Date.now() + TURN_AI_BUDGET_MS;
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

  // Turns that put evidence into the model. The turn *number* still advances on
  // every answer — conversation rows are keyed by it — but a turn the analyst
  // read nothing out of has not moved the diagnosis, so it earns no progress and
  // does not count toward the length the interview needs before it may finish.
  const productiveTurnIds = new Set(priorEvidence.map((e) => e.turn_id));

  // --- safety gate (§34.2) — before any extraction --------------------------
  const distress = await checkDistress(message, deadline);
  if (distress.level === "crisis") {
    const reply = buildCrisisReply();
    await repo.saveConversationTurn(sessionId, turn, "assistant", reply);
    await repo.setSessionStatus(sessionId, "aborted");
    return {
      reply,
      turn,
      progress: computeProgress({
        productiveTurns: productiveTurnIds.size,
        meanConfidence: diagnosisConfidence(states),
        overallCoverage: overallCoverage(aggregateAxes(states)),
      }),
      isComplete: false,
      resultUrl: null,
      aborted: true,
    };
  }

  const lastQuestion = askedQuestions[askedQuestions.length - 1]?.text ?? "";
  const recentlyUpdated = [...states.values()]
    .filter((s) => s.last_updated_turn >= turn - 3 && s.evidence_count > 0)
    .map((s) => s.element_id);

  // --- Call A: evidence extraction (§22-3) ----------------------------------
  //
  // Deliberately *not* wrapped in a fallback. Evidence extraction is the only
  // step that turns a conversation into a diagnosis, so a turn that cannot
  // extract has produced nothing worth recording. Swallowing the failure and
  // continuing with zero evidence lets the interview run its full length and
  // finish "complete" on an empty model — the user answers 30 questions and
  // receives a result built from nothing. Failing here instead keeps the turn
  // uncounted and asks the user to resend; their answer is already saved above,
  // and the turn number is unchanged, so the retry simply replaces it.
  const analyst = await runAnalystCall({
    question: lastQuestion,
    answer: message,
    elementIds: selectContextElements({
      states,
      contradictions: priorContradictions,
      recentlyUpdated,
    }),
    conversation,
    recentEvidence: priorEvidence,
    contradictions: priorContradictions,
  }, deadline);

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

  for (const e of update.newEvidence) productiveTurnIds.add(e.turn_id);
  const productiveTurns = productiveTurnIds.size;

  if (update.newEvidence.length === 0) {
    console.warn(
      `[turnService] turn ${turn} produced no evidence — not counted toward progress or termination`
    );
  }

  const progress = computeProgress({
    productiveTurns,
    meanConfidence: update.meanConfidence,
    overallCoverage: update.coverage,
  });

  // --- termination (§33) -----------------------------------------------------
  const termination = evaluateTermination({
    productiveTurns,
    totalTurns: turn,
    meanConfidence: update.meanConfidence,
    overallCoverage: update.coverage,
    unresolvedContradictions: update.unresolvedContradictions,
    // Empty turns would otherwise read as a flat curve and trip the saturation
    // rule, ending the interview because nothing was learned.
    meanConfidenceHistory: confidenceHistory
      .filter((point) => productiveTurnIds.has(point.turn))
      .map((point) => point.meanConfidence),
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
    deadline,
  });

  // --- reply (§22-15) --------------------------------------------------------
  let reply: string;
  try {
    reply = await runReplyCall({
      answer: message,
      nextQuestion: nextQuestion.question.text,
      distress: distress.level === "distress",
    }, deadline);
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
  deadline: number;
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
        input.turn,
        input.deadline
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

export class SessionClosedError extends Error {
  constructor() {
    super("session is no longer active");
    this.name = "SessionClosedError";
  }
}

export const MAX_INTERVIEW_TURNS = MAX_TURNS;
