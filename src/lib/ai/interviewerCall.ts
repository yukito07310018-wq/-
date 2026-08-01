import { callModel, callModelStructured } from "./client";
import {
  buildInterviewerUserPrompt,
  buildReplyUserPrompt,
  INTERVIEWER_SYSTEM_PROMPT,
  REPLY_SYSTEM_PROMPT,
  type InterviewerPromptInput,
  type ReplyPromptInput,
} from "./prompts";
import { QuestionGenerationSchema } from "../validation/schemas";
import type { QuestionCandidate } from "../types/diagnosis";

/** Call B (§22 step 12): question candidate generation at temperature 0.7. */

export const INTERVIEWER_MAX_TOKENS = 800;
export const INTERVIEWER_TEMPERATURE = 0.7;
export const REPLY_MAX_TOKENS = 400;
export const REPLY_TEMPERATURE = 0.7;
export const MAX_QUESTION_CHARS = 120;

/**
 * Generates 3-5 candidates. Malformed-but-valid outputs (too long, closed
 * questions) are filtered here rather than being sent to the selector, so the
 * §16 rules hold regardless of what the model returns.
 */
export async function runInterviewerCall(
  input: InterviewerPromptInput,
  turn: number
): Promise<QuestionCandidate[]> {
  const result = await callModelStructured({
    label: "interviewer",
    system: INTERVIEWER_SYSTEM_PROMPT,
    user: buildInterviewerUserPrompt(input),
    maxTokens: INTERVIEWER_MAX_TOKENS,
    temperature: INTERVIEWER_TEMPERATURE,
    prefill: '{"questions":',
    schema: QuestionGenerationSchema,
  });

  const banned = new Set(input.avoidProbeKinds);

  return result.questions
    .filter((q) => [...q.text].length <= MAX_QUESTION_CHARS)
    .filter((q) => !banned.has(q.probe_kind))
    .map((q, index) => ({
      question_id: `q-${turn}-${index}`,
      text: q.text.trim(),
      target_elements: q.target_elements,
      probe_kind: q.probe_kind,
      expected_yield: q.expected_yield,
      rationale: q.rationale,
    }));
}

/**
 * Turns the selected question into a natural reply.
 * The question text is appended verbatim afterwards regardless of what the model
 * produced, so the selected question can never be silently rewritten (§23).
 */
export async function runReplyCall(input: ReplyPromptInput): Promise<string> {
  const raw = await callModel({
    label: "reply",
    system: REPLY_SYSTEM_PROMPT,
    user: buildReplyUserPrompt(input),
    maxTokens: REPLY_MAX_TOKENS,
    temperature: REPLY_TEMPERATURE,
  });

  const acknowledgement = stripQuestion(raw.trim(), input.nextQuestion);
  return acknowledgement ? `${acknowledgement}\n\n${input.nextQuestion}` : input.nextQuestion;
}

/** Removes the model's own copy of the question so it is not printed twice. */
function stripQuestion(reply: string, question: string): string {
  const index = reply.indexOf(question);
  const body = index === -1 ? reply : reply.slice(0, index);
  return body.trim();
}
