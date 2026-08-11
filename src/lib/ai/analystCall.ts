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

/** Why a second extraction pass is being run, which decides how it is nudged. */
type RetryReason = "ungrounded" | "empty";

/**
 * Extracts evidence and verifies every quote against the actual answer.
 *
 * A batch with 3+ ungrounded quotes triggers exactly one re-extraction
 * (§9.1-5), and so does a batch that yielded nothing at all from a real answer:
 * a turn that contributes no evidence advances the interview without advancing
 * the model, which is the outcome this whole pipeline exists to avoid. Whatever
 * survives the second pass is what gets used.
 */
export async function runAnalystCall(
  input: AnalystPromptInput,
  deadline?: number
): Promise<AnalystResult> {
  const first = await extractOnce(input, undefined, deadline);
  const firstVerified = verifyEvidenceQuotes(first.evidence, input.answer);

  if (!firstVerified.shouldRepair) {
    return {
      evidence: firstVerified.accepted,
      contradictionCandidates: first.contradiction_candidates,
      rejectedCount: firstVerified.rejected.length,
      repaired: false,
    };
  }

  const reason: RetryReason = firstVerified.accepted.length === 0 ? "empty" : "ungrounded";
  console.warn(
    `[analystCall] re-running extraction (${reason}: ${firstVerified.accepted.length} accepted, ${firstVerified.rejected.length} rejected)`
  );

  // The repair is an attempt to do better, never a reason to do worse: if it
  // fails outright, the first pass's already-verified evidence still stands.
  // Letting the error escape here would throw away good evidence and fail the
  // whole turn over a transient fault on an optional second opinion.
  let second: Awaited<ReturnType<typeof extractOnce>> | null = null;
  try {
    second = await extractOnce(input, reason, deadline);
  } catch (error) {
    console.error("[analystCall] re-extraction failed, keeping the first pass:", error);
  }

  if (!second) {
    return {
      evidence: firstVerified.accepted,
      contradictionCandidates: first.contradiction_candidates,
      rejectedCount: firstVerified.rejected.length,
      repaired: true,
    };
  }

  const secondVerified = verifyEvidenceQuotes(second.evidence, input.answer);

  // Keep whichever pass produced more grounded evidence.
  const useSecond = secondVerified.accepted.length >= firstVerified.accepted.length;
  const evidence = useSecond ? secondVerified.accepted : firstVerified.accepted;

  if (evidence.length === 0) {
    console.warn("[analystCall] both extraction passes produced no grounded evidence");
  }

  return {
    evidence,
    contradictionCandidates: useSecond
      ? second.contradiction_candidates
      : first.contradiction_candidates,
    rejectedCount: firstVerified.rejected.length + secondVerified.rejected.length,
    repaired: true,
  };
}

const RETRY_NOTES: Record<RetryReason, string> = {
  ungrounded:
    "重要: 前回の抽出では、ユーザーの発話に存在しない引用が含まれていました。quote は必ず上記 <user_answer> 内の文字列をそのまま切り出してください。該当する引用が作れない証拠は出力しないでください。",
  // Deliberately does NOT demand at least one item. Ordering the model to
  // always produce evidence would just move the failure: quote verification
  // only proves a span was uttered, not that it supports the element, so a
  // forced extraction yields grounded-looking quotes with invented readings.
  // An empty model is a visible problem; a fabricated one is not (§1.3).
  empty:
    "補足: 前回の抽出では有効な証拠が1件も得られませんでした。解釈の抽象度が高すぎた可能性があるため、行動・選択・判断・価値観を具体的に示している箇所がないか、<user_answer> をもう一度確認してください。確信が持てない場合は strength と reliability を低く設定して構いません。ただし、実際に判断材料が含まれていない場合は、無理に証拠を作らず空配列を返してください。",
};

async function extractOnce(
  input: AnalystPromptInput,
  retryReason?: RetryReason,
  deadline?: number
) {
  const base = buildAnalystUserPrompt(input);
  const user = retryReason ? `${base}\n\n${RETRY_NOTES[retryReason]}` : base;

  return callModelStructured({
    label: "analyst",
    system: ANALYST_SYSTEM_PROMPT,
    user,
    maxTokens: ANALYST_MAX_TOKENS,
    temperature: ANALYST_TEMPERATURE,
    prefill: '{"evidence":',
    schema: EvidenceExtractionSchema,
    deadline,
  });
}
