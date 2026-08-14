import { callModelStructured } from "./client";
import { buildAnalystUserPrompt, ANALYST_SYSTEM_PROMPT, type AnalystPromptInput } from "./prompts";
import { EvidenceExtractionSchema } from "../validation/schemas";
import { verifyEvidenceQuotes } from "../validation/quoteVerifier";
import { debugLog, reconcileElementIds } from "../debug/diagnosisDebug";
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
  debugLog("analyst", "call A input", {
    answer_chars: input.answer.length,
    catalogue_element_ids: input.elementIds.length,
    catalogue_sample: input.elementIds.slice(0, 5),
    prior_evidence: input.recentEvidence.length,
  });

  const first = await extractOnce(input);
  const firstVerified = verifyEvidenceQuotes(first.evidence, input.answer);

  debugLog("analyst", "quote verification (pass 1)", {
    in: first.evidence.length,
    accepted: firstVerified.accepted.length,
    rejected: firstVerified.rejected.map((r) => ({
      element_id: r.evidence.element_id,
      reason: r.reason,
      similarity: Number(r.similarity.toFixed(3)),
      quote_chars: [...r.evidence.quote].length,
      quote: r.evidence.quote,
    })),
  });

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
  const secondVerified = verifyEvidenceQuotes(second.evidence, input.answer);

  debugLog("analyst", "quote verification (pass 2)", {
    in: second.evidence.length,
    accepted: secondVerified.accepted.length,
    rejected: secondVerified.rejected.map((r) => ({
      element_id: r.evidence.element_id,
      reason: r.reason,
      similarity: Number(r.similarity.toFixed(3)),
    })),
  });

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

  const result = await callModelStructured({
    label: "analyst",
    system: ANALYST_SYSTEM_PROMPT,
    user,
    maxTokens: ANALYST_MAX_TOKENS,
    temperature: ANALYST_TEMPERATURE,
    prefill: '{"evidence":',
    schema: EvidenceExtractionSchema,
    // (4) element_id reconciliation, before the schema decides. The schema is
    // where matching actually happens, and it rejects the whole batch on one
    // unknown id — so these counts are the only place a partial mismatch shows.
    onRawParsed: (value) => {
      debugLog("analyst", "element_id reconciliation (before schema)", reconcileElementIds(value));
    },
  });

  // (3) evidence array length after parsing + validation.
  debugLog("analyst", "parsed evidence (after schema)", {
    evidence: result.evidence.length,
    element_ids: result.evidence.map((e) => e.element_id),
    contradiction_candidates: result.contradiction_candidates.length,
  });

  return result;
}
