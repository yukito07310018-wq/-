/**
 * Deterministic text similarity (§21). No external library: character-trigram
 * Jaccard is stable, cheap, and works acceptably on Japanese where whitespace
 * tokenisation does not.
 */

const FULLWIDTH_START = 0xff01;
const FULLWIDTH_END = 0xff5e;
const ASCII_OFFSET = 0xfee0;

/**
 * Normalises text for comparison: full-width → half-width, lower-case,
 * whitespace and punctuation/symbols removed.
 */
export function normalizeText(input: string): string {
  let s = input.normalize("NFKC");
  s = s.replace(/[！-～]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return code >= FULLWIDTH_START && code <= FULLWIDTH_END
      ? String.fromCharCode(code - ASCII_OFFSET)
      : ch;
  });
  s = s.toLowerCase();
  s = s.replace(/\s+/gu, "");
  // Strip punctuation and symbols but keep letters, digits and CJK.
  s = s.replace(/[\p{P}\p{S}]/gu, "");
  return s;
}

export function trigrams(text: string): Set<string> {
  const chars = [...text];
  const out = new Set<string>();
  if (chars.length === 0) return out;
  if (chars.length <= 3) {
    out.add(chars.join(""));
    return out;
  }
  for (let i = 0; i + 3 <= chars.length; i++) {
    out.add(chars.slice(i, i + 3).join(""));
  }
  return out;
}

/** Jaccard coefficient over character trigrams of the normalised strings. */
export function trigramJaccard(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na.length === 0 && nb.length === 0) return 1;
  if (na.length === 0 || nb.length === 0) return 0;
  if (na === nb) return 1;

  const ta = trigrams(na);
  const tb = trigrams(nb);
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Highest similarity between `text` and any of `others`. 0 when `others` is empty. */
export function maxSimilarity(text: string, others: readonly string[]): number {
  let max = 0;
  for (const other of others) {
    const sim = trigramJaccard(text, other);
    if (sim > max) max = sim;
  }
  return max;
}
