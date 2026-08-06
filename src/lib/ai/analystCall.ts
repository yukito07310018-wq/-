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
    `[analystCall] ===== STARTING EXTRACTION =====\n` +
    `  question="${input.question.slice(0, 60)}\n` +
    `  answer length=${[...input.answer].length} chars, content="${input.answer.slice(0, 60)}..."\n` +
    `  elements selected=${input.elementIds.length}, conversation=${input.conversation.length} msgs, ` +
    `recent evidence=${input.recentEvidence.length}, contradictions=${input.contradictions.length}`
  );

  const first = await extractOnce(input);
  console.info(
    `[analystCall] first pass raw result: evidence=${first.evidence.length} items, ` +
    `contradictions=${first.contradiction_candidates.length}`
  );
  if (first.evidence.length === 0) {
    console.warn(`[analystCall] ⚠️  WARNING: first pass returned ZERO evidence items!`);
  } else {
    console.info(`[analystCall] first pass evidence items: ${first.evidence.map(e => `${e.element_id}(strength=${e.strength.toFixed(2)})`).join(", ")}`);
  }

  const firstVerified = verifyEvidenceQuotes(first.evidence, input.answer);
  console.info(
    `[analystCall] first pass verification: accepted=${firstVerified.accepted.length}, ` +
    `rejected=${firstVerified.rejected.length}, shouldRepair=${firstVerified.shouldRepair}`
  );

  if (!firstVerified.shouldRepair) {
    console.info(
      `[analystCall] ===== FINAL RESULT (no repair needed) =====\n` +
      `  accepted=${firstVerified.accepted.length}, rejected=${firstVerified.rejected.length}`
    );
    return {
      evidence: firstVerified.accepted,
      contradictionCandidates: first.contradiction_candidates,
      rejectedCount: firstVerified.rejected.length,
      repaired: false,
    };
  }

  console.warn(
    `[analystCall] REPAIR TRIGGERED: ${firstVerified.rejected.length} ungrounded quotes — re-running extraction once`
  );

  const second = await extractOnce(input, true);
  console.info(`[analystCall] second pass raw result: evidence=${second.evidence.length} items, contradictions=${second.contradiction_candidates.length}`);
  if (second.evidence.length === 0) {
    console.warn(`[analystCall] ⚠️  WARNING: second pass also returned ZERO evidence items!`);
  }

  const secondVerified = verifyEvidenceQuotes(second.evidence, input.answer);
  console.info(
    `[analystCall] second pass verification: accepted=${secondVerified.accepted.length}, ` +
    `rejected=${secondVerified.rejected.length}`
  );

  // Keep whichever pass produced more grounded evidence.
  const useSecond = secondVerified.accepted.length >= firstVerified.accepted.length;
  console.info(
    `[analystCall] ===== FINAL RESULT (repaired) =====\n` +
    `  using ${useSecond ? "second" : "first"} pass: accepted=${useSecond ? secondVerified.accepted.length : firstVerified.accepted.length}\n` +
    `  total rejected=${firstVerified.rejected.length + secondVerified.rejected.length}`
  );

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

  console.info(
    `[analystCall.extractOnce] calling model (emphasiseQuotes=${emphasiseQuotes})\n` +
    `  user prompt length=${user.length} chars\n` +
    `  element IDs in prompt: ${input.elementIds.length}\n` +
    `  system prompt length=${ANALYST_SYSTEM_PROMPT.length} chars\n` +
    `  max tokens=${ANALYST_MAX_TOKENS}, temperature=${ANALYST_TEMPERATURE}`
  );

  const result = await callModelStructured({
    label: "analyst",
    system: ANALYST_SYSTEM_PROMPT,
    user,
    maxTokens: ANALYST_MAX_TOKENS,
    temperature: ANALYST_TEMPERATURE,
    prefill: '{"evidence":',
    schema: EvidenceExtractionSchema,
  });

  console.info(
    `[analystCall.extractOnce] model returned: ${result.evidence.length} evidence items, ` +
    `${result.contradiction_candidates.length} contradiction candidates`
  );

  if (result.evidence.length > 0) {
    console.info(
      `[analystCall.extractOnce] evidence details:\n${result.evidence.map((e, i) => `  [${i}] ${e.element_id} | type=${e.type} | strength=${e.strength.toFixed(2)} | reliability=${e.reliability.toFixed(2)} | direction=${e.direction} | quote="${e.quote.slice(0, 40)}..."`).join("\n")}`
    );
  }

  return result;
}
