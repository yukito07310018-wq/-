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
export async function runAnalystCall(input: AnalystPromptInput): Promise<AnalystResult> {
  const first = await extractOnce(input);
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

  const second = await extractOnce(input, reason);
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
  empty:
    "重要: 前回の抽出では、有効な証拠が1件も得られませんでした。この回答には必ず何らかの手がかりが含まれています。抽象度の高い解釈にこだわらず、行動・選択・判断・価値観のいずれかを示す箇所を <user_answer> からそのまま引用し、確信が持てない場合は strength と reliability を低く設定したうえで、最低1件は出力してください。引用は10文字以上120文字以内の連続した部分文字列であること。",
};

async function extractOnce(input: AnalystPromptInput, retryReason?: RetryReason) {
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
  });
}
