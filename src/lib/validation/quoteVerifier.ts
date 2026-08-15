import { normalizeText, trigramJaccard } from "../engine/similarity";
import { stripUserAnswerTags } from "./userText";
import type { EvidenceDraft, Evidence } from "../types/diagnosis";

/**
 * §9.1 — quote grounding.
 *
 * The analyst model is instructed to quote verbatim, but instructions alone do
 * not prevent fabrication. Every quote is checked against what the user actually
 * said and dropped when it cannot be found there.
 *
 * "What the user actually said" means every user utterance the prompt put in
 * front of the model, not just the current turn — the model is shown six turns
 * of history and quoting from it is legitimate. It never means the interviewer's
 * side of the conversation; the caller passes user text only.
 */

/**
 * Below this a quote stops identifying anything: two characters match somewhere
 * in almost any answer, so the check would pass without evidence of anything.
 * It is deliberately near the floor. Japanese carries meaning densely — 「負の空間
 * を読む」 is seven characters and is the most quotable line in its answer — so
 * length is not used as a proxy for how much a quote is worth. That judgement
 * belongs to strength/reliability, which are scored per item and feed the
 * confidence formula; a short filler span survives this check and then earns
 * nothing downstream.
 */
export const MIN_QUOTE_CHARS = 3;
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

/** One or more user utterances a quote may legitimately have come from. */
export type QuoteSources = string | readonly string[];

function normalizedSources(sources: QuoteSources): string[] {
  const list = typeof sources === "string" ? [sources] : sources;
  return list
    // The model was shown the sanitised text, so that is what a quote is
    // checked against — otherwise a span crossing a stripped tag is verbatim
    // to the model and absent here (§34.3).
    .map((s) => normalizeText(stripUserAnswerTags(s)))
    .filter((s) => s.length > 0);
}

/** Verifies a single quote against the utterance(s) it could have come from. */
export function verifyQuote(quote: string, sources: QuoteSources): QuoteCheck {
  const quoteLength = [...quote.trim()].length;
  if (quoteLength < MIN_QUOTE_CHARS) return { ok: false, reason: "too_short", similarity: 0 };
  if (quoteLength > MAX_QUOTE_CHARS) return { ok: false, reason: "too_long", similarity: 0 };

  const nq = normalizeText(quote);
  if (nq.length === 0) return { ok: false, reason: "too_short", similarity: 0 };

  let best = 0;
  for (const nu of normalizedSources(sources)) {
    if (nu.includes(nq)) return { ok: true, similarity: 1 };

    // Substring match failed — allow near-misses caused by orthographic
    // variation, comparing against the best-matching window of the utterance
    // rather than the whole thing (a short true quote inside a long answer has
    // low global overlap).
    const similarity = bestWindowSimilarity(nq, nu);
    if (similarity > best) best = similarity;
  }

  if (best >= FUZZY_THRESHOLD) return { ok: true, similarity: best };
  return { ok: false, reason: "not_grounded", similarity: best };
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
  sources: QuoteSources
): QuoteVerificationResult {
  const accepted: EvidenceDraft[] = [];
  const rejected: QuoteVerificationResult["rejected"] = [];

  for (const draft of drafts) {
    const check = verifyQuote(draft.quote, sources);
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

/**
 * Drops quotes already recorded for the same element on an earlier turn.
 *
 * Verifying against the whole visible history is what lets the model cite turn 2
 * on turn 5; the cost is that it can cite turn 2 again on turns 6 and 7. Each
 * repeat would otherwise land as a fresh Evidence row and raise evidence_count
 * and confidence for a characteristic the user only ever spoke about once. Same
 * element + same words is the same observation, so it is admitted once.
 *
 * A duplicate is not a rejection: the model did nothing wrong, so it must not
 * count toward the re-extraction trigger.
 */
export function dropAlreadyRecorded(
  drafts: readonly EvidenceDraft[],
  priorEvidence: readonly Evidence[]
): { kept: EvidenceDraft[]; duplicates: EvidenceDraft[] } {
  // A space separates the two halves unambiguously: normalizeText strips all
  // whitespace, so the normalised quote can never contain one.
  const seen = new Set(priorEvidence.map((e) => `${e.element_id} ${normalizeText(e.quote)}`));
  const kept: EvidenceDraft[] = [];
  const duplicates: EvidenceDraft[] = [];

  for (const draft of drafts) {
    const key = `${draft.element_id} ${normalizeText(draft.quote)}`;
    if (seen.has(key)) {
      duplicates.push(draft);
      continue;
    }
    seen.add(key);
    kept.push(draft);
  }

  return { kept, duplicates };
}
