import { callModelStructured } from "./client";
import {
  buildAnalystUserPrompt,
  visibleUserUtterances,
  ANALYST_SYSTEM_PROMPT,
  type AnalystPromptInput,
} from "./prompts";
import { EvidenceExtractionSchema } from "../validation/schemas";
import {
  dropAlreadyRecorded,
  verifyEvidenceQuotes,
  type QuoteVerificationResult,
} from "../validation/quoteVerifier";
import type { EvidenceDraft } from "../types/diagnosis";
import type { ContradictionCandidateInput } from "../engine/contradictionEngine";

/** Call A (§22 step 3): evidence extraction at temperature 0. */

export const ANALYST_MAX_TOKENS = 1500;
export const ANALYST_TEMPERATURE = 0;

export interface AnalystResult {
  evidence: EvidenceDraft[];
  contradictionCandidates: ContradictionCandidateInput[];
  rejectedCount: number;
  /** Grounded quotes already recorded for the same element on an earlier turn. */
  duplicateCount: number;
  repaired: boolean;
}

/**
 * Every user utterance the prompt put in front of the model this turn.
 *
 * The prompt shows six turns of history, so the model can and does quote from
 * earlier answers; checking only against the current one rejected those quotes
 * as fabrications. AI lines are excluded — the interviewer's own questions are
 * visible to the model but are not evidence about the user.
 */
function quoteCorpus(input: AnalystPromptInput): string[] {
  return [...visibleUserUtterances(input.conversation), input.answer];
}

/**
 * Extracts evidence and verifies every quote against what the user actually said.
 * A batch with 3+ ungrounded quotes triggers exactly one re-extraction (§9.1-5);
 * whatever survives the second pass is what gets used.
 */
export async function runAnalystCall(input: AnalystPromptInput): Promise<AnalystResult> {
  const sources = quoteCorpus(input);

  const first = await extractOnce(input);
  const firstVerified = verifyEvidenceQuotes(first.evidence, sources);

  if (!firstVerified.shouldRepair) {
    return finish(input, firstVerified, first.contradiction_candidates, {
      rejectedCount: firstVerified.rejected.length,
      repaired: false,
    });
  }

  console.warn(
    `[analystCall] ${firstVerified.rejected.length} ungrounded quotes — re-running extraction once`
  );

  const second = await extractOnce(input, true);
  const secondVerified = verifyEvidenceQuotes(second.evidence, sources);

  // Keep whichever pass produced more grounded evidence.
  const useSecond = secondVerified.accepted.length >= firstVerified.accepted.length;
  return finish(
    input,
    useSecond ? secondVerified : firstVerified,
    useSecond ? second.contradiction_candidates : first.contradiction_candidates,
    {
      rejectedCount: firstVerified.rejected.length + secondVerified.rejected.length,
      repaired: true,
    }
  );
}

function finish(
  input: AnalystPromptInput,
  verified: QuoteVerificationResult,
  contradictionCandidates: ContradictionCandidateInput[],
  meta: { rejectedCount: number; repaired: boolean }
): AnalystResult {
  const { kept, duplicates } = dropAlreadyRecorded(verified.accepted, input.recentEvidence);
  if (duplicates.length > 0) {
    console.warn(
      `[analystCall] ${duplicates.length} quotes already recorded on an earlier turn — not counted again`
    );
  }
  return {
    evidence: kept,
    contradictionCandidates,
    rejectedCount: meta.rejectedCount,
    duplicateCount: duplicates.length,
    repaired: meta.repaired,
  };
}

async function extractOnce(input: AnalystPromptInput, emphasiseQuotes = false) {
  const base = buildAnalystUserPrompt(input);
  const user = emphasiseQuotes
    ? `${base}\n\n重要: 前回の抽出では、ユーザーの発話に存在しない引用が含まれていました。quote は必ず上記 <user_answer> 内、または「直近の会話」の USER 行の文字列をそのまま切り出してください。AI 行から引用してはいけません。該当する引用が作れない証拠は出力しないでください。`
    : base;

  return callModelStructured({
    label: "analyst",
    system: ANALYST_SYSTEM_PROMPT,
    user,
    maxTokens: ANALYST_MAX_TOKENS,
    temperature: ANALYST_TEMPERATURE,
    prefill: '{"evidence":',
    schema: EvidenceExtractionSchema,
  });
}
