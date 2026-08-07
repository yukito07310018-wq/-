import { callModelStructured } from "./client";
import { buildAnalystUserPrompt, ANALYST_SYSTEM_PROMPT, type AnalystPromptInput } from "./prompts";
import { EvidenceExtractionSchema } from "../validation/schemas";
import {
  emptyRejectionCounts,
  verifyEvidenceQuotes,
  type QuoteRejectionCounts,
} from "../validation/quoteVerifier";
import type { EvidenceDraft } from "../types/diagnosis";
import type { ContradictionCandidateInput } from "../engine/contradictionEngine";

/** Call A (§22 step 3): evidence extraction at temperature 0. */

export const ANALYST_MAX_TOKENS = 1500;
export const ANALYST_TEMPERATURE = 0;

export interface AnalystResult {
  evidence: EvidenceDraft[];
  contradictionCandidates: ContradictionCandidateInput[];
  /** Items the model emitted across every pass, before quote verification. */
  extractedCount: number;
  rejectedCount: number;
  rejectionCounts: QuoteRejectionCounts;
  repaired: boolean;
}

function sumCounts(a: QuoteRejectionCounts, b: QuoteRejectionCounts): QuoteRejectionCounts {
  return {
    too_short: a.too_short + b.too_short,
    too_long: a.too_long + b.too_long,
    not_grounded: a.not_grounded + b.not_grounded,
  };
}

/**
 * Extracts evidence and verifies every quote against the actual answer.
 * A failing batch triggers exactly one re-extraction (§9.1-5); whatever survives
 * the second pass is what gets used. The counts returned here are what makes a
 * silent extraction failure visible downstream — do not drop them.
 */
export async function runAnalystCall(input: AnalystPromptInput): Promise<AnalystResult> {
  const first = await extractOnce(input);
  const firstVerified = verifyEvidenceQuotes(first.evidence, input.answer);

  if (!firstVerified.shouldRepair) {
    return {
      evidence: firstVerified.accepted,
      contradictionCandidates: first.contradiction_candidates,
      extractedCount: first.evidence.length,
      rejectedCount: firstVerified.rejected.length,
      rejectionCounts: firstVerified.rejectionCounts,
      repaired: false,
    };
  }

  console.warn(
    `[analystCall] ${firstVerified.rejected.length} ungrounded quotes, ${firstVerified.accepted.length} kept — re-running extraction once`
  );

  const second = await extractOnce(input, true);
  const secondVerified = verifyEvidenceQuotes(second.evidence, input.answer);

  // Keep whichever pass produced more grounded evidence.
  const useSecond = secondVerified.accepted.length >= firstVerified.accepted.length;
  return {
    evidence: useSecond ? secondVerified.accepted : firstVerified.accepted,
    contradictionCandidates: useSecond
      ? second.contradiction_candidates
      : first.contradiction_candidates,
    extractedCount: first.evidence.length + second.evidence.length,
    rejectedCount: firstVerified.rejected.length + secondVerified.rejected.length,
    rejectionCounts: sumCounts(firstVerified.rejectionCounts, secondVerified.rejectionCounts),
    repaired: true,
  };
}

/** The shape used when Call A itself fails, so the turn still records what happened. */
export function emptyAnalystResult(): AnalystResult {
  return {
    evidence: [],
    contradictionCandidates: [],
    extractedCount: 0,
    rejectedCount: 0,
    rejectionCounts: emptyRejectionCounts(),
    repaired: false,
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
