import { normalizeText, trigramJaccard } from "../engine/similarity";
import type { EvidenceDraft } from "../types/diagnosis";

/**
 * §9.1 — quote grounding.
 *
 * The analyst model is instructed to quote verbatim, but instructions alone do
 * not prevent fabrication. Every quote is checked against the actual user
 * utterance and dropped when it cannot be found there.
 */

export const MIN_QUOTE_CHARS = 10;
export const MAX_QUOTE_CHARS = 120;
export const FUZZY_THRESHOLD = 0.85;
/** Rejecting this many items in one turn triggers a single Call A repair (§9.1-5). */
export const REPAIR_TRIGGER_REJECTIONS = 3;

export type QuoteRejectionReason = "too_short" | "too_long" | "not_grounded";

export interface QuoteVerificationResult {
  accepted: EvidenceDraft[];
  rejected: { evidence: EvidenceDraft; reason: QuoteRejectionReason; similarity: number }[];
  /** True when the caller should retry Call A once (§9.1-5). */
  shouldRepair: boolean;
}

export interface QuoteCheck {
  ok: boolean;
  reason?: QuoteRejectionReason;
  similarity: number;
}

/** Verifies a single quote against the utterance it claims to come from. */
export function verifyQuote(quote: string, utterance: string): QuoteCheck {
  const quoteLength = [...quote.trim()].length;
  if (quoteLength < MIN_QUOTE_CHARS) return { ok: false, reason: "too_short", similarity: 0 };
  if (quoteLength > MAX_QUOTE_CHARS) return { ok: false, reason: "too_long", similarity: 0 };

  const nq = normalizeText(quote);
  const nu = normalizeText(utterance);
  if (nq.length === 0) return { ok: false, reason: "too_short", similarity: 0 };
  if (nu.includes(nq)) return { ok: true, similarity: 1 };

  // Substring match failed — allow near-misses caused by orthographic variation,
  // comparing against the best-matching window of the utterance rather than the
  // whole thing (a short true quote inside a long answer has low global overlap).
  const similarity = bestWindowSimilarity(nq, nu);
  if (similarity >= FUZZY_THRESHOLD) return { ok: true, similarity };
  return { ok: false, reason: "not_grounded", similarity };
}

/** Highest trigram-Jaccard between `needle` and any same-length window of `haystack`. */
function bestWindowSimilarity(needle: string, haystack: string): number {
  const n = [...needle];
  const h = [...haystack];
  if (h.length <= n.length) return trigramJaccard(needle, haystack);

  const windowSize = n.length;
  // Step in proportion to the window so long answers stay cheap; small enough
  // that a true match cannot slip between windows.
  const step = Math.max(1, Math.floor(windowSize / 4));
  let best = 0;
  for (let start = 0; start + windowSize <= h.length; start += step) {
    const sim = trigramJaccard(needle, h.slice(start, start + windowSize).join(""));
    if (sim > best) best = sim;
    if (best >= 1) break;
  }
  // Always test the tail window so the end of the utterance is never skipped.
  const tail = trigramJaccard(needle, h.slice(h.length - windowSize).join(""));
  return Math.max(best, tail);
}

/** Filters a batch of extracted evidence down to the items that are grounded. */
export function verifyEvidenceQuotes(
  drafts: readonly EvidenceDraft[],
  utterance: string
): QuoteVerificationResult {
  const accepted: EvidenceDraft[] = [];
  const rejected: QuoteVerificationResult["rejected"] = [];

  for (const draft of drafts) {
    const check = verifyQuote(draft.quote, utterance);
    if (check.ok) {
      accepted.push(draft);
    } else {
      rejected.push({ evidence: draft, reason: check.reason!, similarity: check.similarity });
      console.warn(
        `[quoteVerifier] dropped evidence for ${draft.element_id} (${check.reason}, sim=${check.similarity.toFixed(2)}): ${draft.quote.slice(0, 40)}`
      );
    }
  }

  return {
    accepted,
    rejected,
    shouldRepair: rejected.length >= REPAIR_TRIGGER_REJECTIONS,
  };
}
