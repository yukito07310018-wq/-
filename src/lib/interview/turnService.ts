import { runInterviewerCall, runReplyCall } from "../ai/interviewerCall";
import { pickFallbackQuestion, pickOpeningQuestion } from "../engine/fallbackQuestions";
import { computeProgress } from "../engine/progress";
import { nextMode, topicRun } from "../engine/questionFlow";
import { selectQuestion } from "../engine/questionSelector";
import { evaluateTermination, MAX_TURNS } from "../engine/terminationEngine";
import { checkDistress, buildCrisisReply, DISTRESS_BANNED_PROBE_KINDS } from "../safety/distressCheck";
import * as repo from "../db/repository";
import type { AskedQuestion, QuestionCandidate, QuestionMode } from "../types/diagnosis";
import type { ConversationMessage } from "../db/repository";

/**
 * One interview turn.
 *
 * The turn no longer extracts anything. Evidence extraction, element updates,
 * axis aggregation and contradiction detection have all moved out of this path
 * and into a single reading over the finished conversation
 * (`interview/readingService`). What a turn does now is: check for distress,
 * save the answer, decide whether the interview is over, and ask the next
 * question.
 *
 * The reason is not performance. The output this app exists to produce — the
 * places a person kept coming back to — is not present in any single utterance,
 * so no amount of per-utterance extraction can find it. Extracting per turn
 * forced short fragments out of answers that had not finished being answers,
 * and the interview it steered jumped subject every turn to feed the elements
 * that looked least measured.
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

  const [askedQuestions, conversation] = await Promise.all([
    repo.loadAskedQuestions(sessionId),
    repo.loadConversation(sessionId),
  ]);

  await repo.saveConversationTurn(sessionId, turn, "user", message);
  await repo.setTurnCount(sessionId, turn);

  // --- safety gate (§34.2) --------------------------------------------------
  // Kept exactly where it was. This app digs into irritation, friction and the
  // things that did not sit right, so serious distress is a foreseeable outcome
  // of the design rather than an edge case; moving the extraction to the end of
  // the session does not change why this runs at the start of every turn.
  const distress = await checkDistress(message);
  if (distress.level === "crisis") {
    const reply = buildCrisisReply();
    await repo.saveConversationTurn(sessionId, turn, "assistant", reply);
    await repo.setSessionStatus(sessionId, "aborted");
    return {
      reply,
      turn,
      progress: computeProgress({ turn }),
      isComplete: false,
      resultUrl: null,
      aborted: true,
    };
  }

  const progress = computeProgress({ turn });

  // --- termination -----------------------------------------------------------
  const termination = evaluateTermination({ turn });
  if (termination.shouldComplete) {
    const reply = buildCompletionReply();
    await repo.saveConversationTurn(sessionId, turn, "assistant", reply);
    await repo.setSessionStatus(sessionId, "completed");
    return {
      reply,
      turn,
      progress,
      isComplete: true,
      resultUrl: `/result/${sessionId}`,
      aborted: false,
    };
  }

  // --- next question ---------------------------------------------------------
  const next = await chooseNextQuestion({
    turn,
    askedQuestions,
    conversation: [...conversation, { turnIndex: turn, role: "user", content: message }],
    bannedKinds: distress.level === "distress" ? [...DISTRESS_BANNED_PROBE_KINDS] : [],
  });

  let reply: string;
  try {
    reply = await runReplyCall({
      answer: message,
      nextQuestion: next.question.text,
      distress: distress.level === "distress",
    });
  } catch (error) {
    console.error("[turnService] reply call failed, sending question only:", error);
    reply = next.question.text;
  }

  await repo.saveConversationTurn(sessionId, turn, "assistant", reply);
  await repo.saveAskedQuestion(sessionId, {
    turn,
    text: next.question.text,
    target_elements: next.question.target_elements,
    probe_kind: next.question.probe_kind,
    mode: next.mode,
  });

  return { reply, turn, progress, isComplete: false, resultUrl: null, aborted: false };
}

interface ChooseQuestionInput {
  turn: number;
  askedQuestions: readonly AskedQuestion[];
  conversation: readonly ConversationMessage[];
  bannedKinds: readonly string[];
}

export interface ChosenQuestion {
  question: QuestionCandidate;
  mode: QuestionMode;
}

/**
 * Picks the next question, and records which of the three things it did.
 *
 * Entering a topic is deterministic: the next unused opener, in file order, with
 * no model call at all. Only deepening needs Call B, and the one thing the model
 * is allowed to change about the plan is releasing the interview from a topic
 * the user has gone flat on — `flat_unknown`. Everything else keeps it where it
 * is, which is the point: four turns on one subject is how a return becomes
 * observable later.
 */
async function chooseNextQuestion(input: ChooseQuestionInput): Promise<ChosenQuestion> {
  const planned = nextMode(input.askedQuestions);

  if (planned === "opening" || planned === "switch") {
    const opener = pickOpeningQuestion(input.askedQuestions);
    if (opener) return { question: opener, mode: planned };
    // All four openers spent — Call B has to find the next subject itself.
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await runInterviewerCall(
        {
          mode: planned,
          topicRun: topicRun(input.askedQuestions),
          conversation: input.conversation,
          askedQuestions: input.askedQuestions,
          avoidProbeKinds: input.bannedKinds,
        },
        input.turn
      );

      const mode = nextMode(input.askedQuestions, result.signal);

      // The answer went flat while we were planning to dig: take a fresh opener
      // if one is left rather than the model's improvised change of subject.
      if (mode === "switch" && planned === "deepen") {
        const opener = pickOpeningQuestion(input.askedQuestions);
        if (opener) return { question: opener, mode };
      }

      const selected = selectQuestion(result.candidates, { askedQuestions: input.askedQuestions });
      if (selected) return { question: selected, mode };
      console.warn(`[turnService] all candidates excluded as duplicates (attempt ${attempt + 1})`);
    } catch (error) {
      console.error(`[turnService] interviewer call failed (attempt ${attempt + 1}):`, error);
    }
  }

  const fallback = pickFallbackQuestion(input.askedQuestions, input.bannedKinds);
  if (fallback) return { question: fallback, mode: "switch" };

  // Every pre-authored question used too: ask the user to expand rather than
  // repeat one verbatim.
  return {
    question: {
      question_id: `open-${input.turn}`,
      text: "ここまでのお話の中で、まだ話していないけれど自分にとって大きかった出来事はありますか。",
      target_elements: [],
      probe_kind: "experience",
      expected_yield: 0.5,
      rationale: "exhausted fallback set",
    },
    mode: "switch",
  };
}

function buildCompletionReply(): string {
  return [
    "ここまでのお話、ありがとうございました。ここで対話を終わりにします。",
    "",
    "結果画面では、話に出てきた話題ごとに、あなたが実際に使っていた言葉をそのまま並べて表示します。",
  ].join("\n");
}

export class SessionNotFoundError extends Error {
  constructor() {
    super("session not found");
    this.name = "SessionNotFoundError";
  }
}

export const MAX_INTERVIEW_TURNS = MAX_TURNS;
