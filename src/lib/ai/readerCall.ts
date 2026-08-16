import { callModelStructured } from "./client";
import { buildReaderUserPrompt, READER_SYSTEM_PROMPT, type ReaderPromptInput } from "./prompts";
import { ReadingExtractionSchema } from "../validation/schemas";
import { buildTranscript, locateQuote } from "../validation/transcript";
import type { ReadingQuote, ReadingSegment } from "../types/reading";

/**
 * The one model call this app makes about a person, run once over the finished
 * conversation.
 */

/**
 * Four thousand, not the 1,500 the per-turn extraction used.
 *
 * That figure was sized for one answer. This call returns quotes drawn from a
 * whole session, and a reply cut off mid-array is not a smaller reading — it is
 * unparseable JSON, which used to be swallowed as "no evidence this turn". The
 * ceiling is generous on purpose, and `ModelOutputTruncatedError` reports it
 * loudly if it is still not enough.
 */
export const READER_MAX_TOKENS = 4000;
export const READER_TEMPERATURE = 0;

export interface ReaderResult {
  segments: ReadingSegment[];
  /** Quotes the model returned that the user never said. */
  rejected: { quote: string; reason: string; similarity: number }[];
}

/**
 * Reads the conversation and keeps only the quotes the user actually uttered.
 *
 * Verification is not optional and its corpus is not the transcript: it is the
 * user's lines alone. In the last measured run, three of six failing quotes were
 * invented and one was the interviewer's own question copied back — which would
 * have passed against a corpus that included the AI's side.
 */
export async function runReaderCall(input: ReaderPromptInput): Promise<ReaderResult> {
  const raw = await callModelStructured({
    label: "reader",
    system: READER_SYSTEM_PROMPT,
    user: buildReaderUserPrompt(input),
    maxTokens: READER_MAX_TOKENS,
    temperature: READER_TEMPERATURE,
    prefill: '{"segments":',
    schema: ReadingExtractionSchema,
  });

  const transcript = buildTranscript(input.conversation);
  const rejected: ReaderResult["rejected"] = [];

  const segments: ReadingSegment[] = raw.segments.map((segment) => {
    const quotes: ReadingQuote[] = [];
    const seen = new Set<string>();

    for (const quote of segment.quotes) {
      const found = locateQuote(quote, transcript);
      if (!found.ok) {
        rejected.push({ quote, reason: found.reason, similarity: found.similarity });
        continue;
      }
      // The same words offered twice are one observation, not two.
      if (seen.has(quote)) continue;
      seen.add(quote);
      quotes.push({ text: quote, turn: found.turn });
    }

    return {
      from_turn: segment.from_turn,
      to_turn: segment.to_turn,
      element_id: segment.element_id,
      quotes,
    };
  });

  if (rejected.length > 0) {
    console.warn(
      `[readerCall] dropped ${rejected.length} quotes the user did not say: ` +
        rejected.map((r) => `${r.reason}/${r.quote.slice(0, 24)}`).join(" | ")
    );
  }

  return { segments, rejected };
}
