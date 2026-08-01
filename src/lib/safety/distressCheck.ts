import supportResourcesFile from "../../../data/supportResources.json";
import { callModelStructured } from "../ai/client";
import { buildDistressUserPrompt, DISTRESS_SYSTEM_PROMPT } from "../ai/prompts";
import { DistressCheckSchema, SupportResourcesFileSchema } from "../validation/schemas";
import type { DistressLevel } from "../types/diagnosis";

/**
 * §34.2 — safety gate.
 *
 * This app deliberately digs into failure, conflict and self-doubt, so serious
 * distress is a foreseeable outcome, not an edge case. The check runs *before*
 * any evidence extraction: on "crisis" the interview stops entirely rather than
 * scoring what the user just disclosed.
 */

export const DISTRESS_MAX_TOKENS = 200;
export const DISTRESS_TEMPERATURE = 0;

/** probe kinds withheld after a distress signal (§34.2). */
export const DISTRESS_BANNED_PROBE_KINDS = ["failure", "conflict"] as const;

const supportResources = (() => {
  const parsed = SupportResourcesFileSchema.safeParse(supportResourcesFile);
  if (!parsed.success) {
    throw new Error("data/supportResources.json の検証に失敗しました。");
  }
  return parsed.data;
})();

export function getSupportResources() {
  return supportResources;
}

/**
 * Fixed template, not generated text (§34.2): a crisis reply must not vary with
 * model temperature.
 */
export function buildCrisisReply(): string {
  const lines = supportResources.resources.map(
    (r) => `・${r.name}: ${r.contact}${r.hours ? `（${r.hours}）` : ""}\n  ${r.note}`
  );
  return [
    "お話しくださって、ありがとうございます。いま、とてもつらい状態にあるように感じました。",
    "",
    "この診断はここで一度中断します。診断結果の表示も行いません。いまはご自身の安全を最優先にしてください。",
    "",
    "ひとりで抱えずに、話せる窓口があります。",
    "",
    ...lines,
    "",
    "身近な人に連絡できそうであれば、その方に今の状況を伝えることも力になります。",
    "落ち着いてから、またいつでも新しく診断を始めることができます。",
  ].join("\n");
}

export interface DistressResult {
  level: DistressLevel;
  reason: string;
}

/**
 * Classifies the user's message. A failed check is treated as "none" so the
 * conversation is not blocked by an AI outage — the crisis path is a safety net
 * on top of the interview, not a gate the interview depends on.
 */
export async function checkDistress(answer: string): Promise<DistressResult> {
  try {
    const result = await callModelStructured({
      label: "distress",
      system: DISTRESS_SYSTEM_PROMPT,
      user: buildDistressUserPrompt(answer),
      maxTokens: DISTRESS_MAX_TOKENS,
      temperature: DISTRESS_TEMPERATURE,
      prefill: '{"level":',
      schema: DistressCheckSchema,
    });
    return { level: result.level, reason: result.reason };
  } catch (error) {
    console.error("[distressCheck] classification failed, continuing as none:", error);
    return { level: "none", reason: "classification_failed" };
  }
}
