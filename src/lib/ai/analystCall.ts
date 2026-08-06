import { callModelStructured } from "./client";
import { buildAnalystUserPrompt, ANALYST_SYSTEM_PROMPT, type AnalystPromptInput } from "./prompts";
import { EvidenceExtractionSchema } from "../validation/schemas";
import { verifyEvidenceQuotes } from "../validation/quoteVerifier";
import type { EvidenceDraft } from "../types/diagnosis";
import type { ContradictionCandidateInput } from "../engine/contradictionEngine";

/** Call A (§22 step 3): evidence extraction at temperature 0. */

export const ANALYST_MAX_TOKENS = 1500;
export const ANALYST_TEMPERATURE = 0;

export interface AnalystResult {
  evidence: EvidenceDraft[];
  contradictionCandidates: ContradictionCandidateInput[];
  rejectedCount: number;
  repaired: boolean;
}

/**
 * Extracts evidence and verifies every quote against the actual answer.
 * A batch with 3+ ungrounded quotes triggers exactly one re-extraction (§9.1-5);
 * whatever survives the second pass is what gets used.
 */
export async function runAnalystCall(input: AnalystPromptInput): Promise<AnalystResult> {
  console.info(
    `[analystCall] starting extraction: question="${input.question.slice(0, 50)}...", ` +
    `answerLength=${input.answer.length}, elementCount=${input.elementIds.length}`
  );

  const first = await extractOnce(input);
  console.info(`[analystCall] first pass extracted ${first.evidence.length} evidence items`);

  const firstVerified = verifyEvidenceQuotes(first.evidence, input.answer);
  console.info(
    `[analystCall] first pass verification: accepted=${firstVerified.accepted.length}, ` +
    `rejected=${firstVerified.rejected.length}, shouldRepair=${firstVerified.shouldRepair}`
  );

  if (!firstVerified.shouldRepair) {
    return {
      evidence: firstVerified.accepted,
      contradictionCandidates: first.contradiction_candidates,
      rejectedCount: firstVerified.rejected.length,
      repaired: false,
    };
  }

  console.warn(
    `[analystCall] ${firstVerified.rejected.length} ungrounded quotes — re-running extraction once`
  );

  const second = await extractOnce(input, true);
  console.info(`[analystCall] second pass extracted ${second.evidence.length} evidence items`);

  const secondVerified = verifyEvidenceQuotes(second.evidence, input.answer);
  console.info(
    `[analystCall] second pass verification: accepted=${secondVerified.accepted.length}, ` +
    `rejected=${secondVerified.rejected.length}`
  );

  // Keep whichever pass produced more grounded evidence.
  const useSecond = secondVerified.accepted.length >= firstVerified.accepted.length;
  return {
    evidence: useSecond ? secondVerified.accepted : firstVerified.accepted,
    contradictionCandidates: useSecond
      ? second.contradiction_candidates
      : first.contradiction_candidates,
    rejectedCount: firstVerified.rejected.length + secondVerified.rejected.length,
    repaired: true,
  };
}

async function extractOnce(input: AnalystPromptInput, emphasiseQuotes = false) {
  const base = buildAnalystUserPrompt(input);
  const user = emphasiseQuotes
    ? `${base}\n\n重要: 前回の抽出では、ユーザーの発話に存在しない引用が含まれていました。quote は必ず上記 <user_answer> 内の文字列をそのまま切り出してください。該当する引用が作れない証拠は出力しないでください。`
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
