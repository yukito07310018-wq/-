import { normalizeTracked, normalizeText, trigramJaccard } from "../engine/similarity";
import { stripUserAnswerTags } from "./userText";
import type { ConversationMessage } from "../db/repository";

/**
 * Quote grounding for the batch reading.
 *
 * The reading is given the whole conversation and asked for the words the
 * person actually used. It will still return words nobody said: of six quotes
 * that failed verification in the last measured run, three were invented
 * outright and one was lifted from the interviewer's own question. So every
 * quote is checked, and it is checked against one thing only — what the *user*
 * said. Including the AI's lines in the corpus would let the model quote a
 * sentence it wrote itself and pass.
 *
 * Reading the whole session at once makes this simpler than it was per-turn:
 * there is one corpus, built once, rather than a sliding window that had to be
 * kept in step with the prompt.
 */

/**
 * Utterance boundary marker.
 *
 * The corpus is one string, so without a boundary a "quote" could be assembled
 * from the tail of one answer and the head of the next — words that were never
 * said together. U+0001 is used because it survives normalisation untouched
 * (it is neither whitespace nor punctuation nor a symbol) while being
 * impossible to type into an answer, so it can never be crossed by a real
 * quote and never matched by one either.
 */
export const UTTERANCE_SEPARATOR = "\u0001";

/**
 * Below this a quote stops identifying anything: two characters match somewhere
 * in almost any answer. Japanese carries meaning densely — 「負の空間を読む」 is
 * seven characters and is the most quotable line in its answer — so length is
 * not used as a proxy for how much a quote is worth.
 */
export const MIN_QUOTE_CHARS = 3;
export const MAX_QUOTE_CHARS = 120;
export const FUZZY_THRESHOLD = 0.85;

export interface Transcript {
  /** Every user utterance, normalised, separated by `UTTERANCE_SEPARATOR`. */
  text: string;
  /** `turns[i]` is the turn the i-th character of `text` came from. */
  turns: number[];
}

/**
 * Builds the corpus a quote may legitimately have come from: the user's lines,
 * in order, and nothing else.
 */
export function buildTranscript(messages: readonly ConversationMessage[]): Transcript {
  const chunks: { text: string; source: number }[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (chunks.length > 0) chunks.push({ text: UTTERANCE_SEPARATOR, source: -1 });
    // The model is shown the sanitised text, so that is what a quote is checked
    // against — otherwise a span crossing a stripped tag is verbatim to the
    // model and absent here (§34.3).
    chunks.push({ text: stripUserAnswerTags(message.content), source: message.turnIndex });
  }
  const { text, sources } = normalizeTracked(chunks);
  return { text, turns: sources };
}

export type QuoteRejectionReason = "too_short" | "too_long" | "not_grounded";

export type QuoteLocation =
  | { ok: true; turn: number; similarity: number }
  | { ok: false; reason: QuoteRejectionReason; similarity: number };

/**
 * Finds a quote in the transcript and reports which turn it came from.
 *
 * The turn matters: the reading counts how many separate times a person came
 * back to a subject, and it can only do that if each quote can be placed in the
 * conversation.
 */
export function locateQuote(quote: string, transcript: Transcript): QuoteLocation {
  const length = [...quote.trim()].length;
  if (length < MIN_QUOTE_CHARS) return { ok: false, reason: "too_short", similarity: 0 };
  if (length > MAX_QUOTE_CHARS) return { ok: false, reason: "too_long", similarity: 0 };

  const needle = normalizeText(quote);
  if (needle.length === 0) return { ok: false, reason: "too_short", similarity: 0 };

  const at = transcript.text.indexOf(needle);
  if (at !== -1) return { ok: true, turn: transcript.turns[at], similarity: 1 };

  // Substring match failed — allow near-misses caused by orthographic
  // variation, comparing against the best-matching window rather than the whole
  // transcript (a short true quote inside a long session has low global overlap).
  const best = bestWindow(needle, transcript.text);
  if (best.similarity >= FUZZY_THRESHOLD) {
    return { ok: true, turn: transcript.turns[best.at], similarity: best.similarity };
  }
  return { ok: false, reason: "not_grounded", similarity: best.similarity };
}

/**
 * Highest trigram-Jaccard between `needle` and any same-length window of
 * `haystack`, and where that window starts. Offsets are UTF-16 indices so they
 * line up with `Transcript.turns`.
 */
function bestWindow(needle: string, haystack: string): { at: number; similarity: number } {
  const size = needle.length;
  if (haystack.length <= size) return { at: 0, similarity: trigramJaccard(needle, haystack) };

  // Step in proportion to the window so a long session stays cheap; small
  // enough that a true match cannot slip between windows.
  const step = Math.max(1, Math.floor(size / 4));
  let best = { at: 0, similarity: 0 };

  const consider = (start: number) => {
    const window = haystack.slice(start, start + size);
    // A window straddling the boundary between two answers is not a quote:
    // those words were never said together.
    if (window.includes(UTTERANCE_SEPARATOR)) return;
    const similarity = trigramJaccard(needle, window);
    if (similarity > best.similarity) best = { at: start, similarity };
  };

  for (let start = 0; start + size <= haystack.length; start += step) {
    consider(start);
    if (best.similarity >= 1) return best;
  }
  // Always test the tail window so the end of the transcript is never skipped.
  consider(haystack.length - size);
  return best;
}
