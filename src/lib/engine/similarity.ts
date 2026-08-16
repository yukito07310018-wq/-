/**
 * Deterministic text similarity (§21). No external library: character-trigram
 * Jaccard is stable, cheap, and works acceptably on Japanese where whitespace
 * tokenisation does not.
 */

const FULLWIDTH_START = 0xff01;
const FULLWIDTH_END = 0xff5e;
const ASCII_OFFSET = 0xfee0;

/**
 * Everything in normalisation after the NFKC pass, applied to one character.
 *
 * NFKC has to run over the whole string (it composes across characters — a bare
 * dakuten joins the kana before it), but every step after it is per-character.
 * Splitting them this way is what lets `normalizeTracked` say where each
 * surviving character came from without a second, drifting copy of these rules.
 * Returns "" for characters that normalisation drops.
 */
function normalizeChar(ch: string): string {
  const code = ch.charCodeAt(0);
  const halfWidth =
    code >= FULLWIDTH_START && code <= FULLWIDTH_END
      ? String.fromCharCode(code - ASCII_OFFSET)
      : ch;
  const lowered = halfWidth.toLowerCase();
  // Drop whitespace, punctuation and symbols; keep letters, digits and CJK.
  return lowered.replace(/\s/gu, "").replace(/[\p{P}\p{S}]/gu, "");
}

/**
 * Normalises text for comparison: full-width → half-width, lower-case,
 * whitespace and punctuation/symbols removed.
 */
export function normalizeText(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFKC")) out += normalizeChar(ch);
  return out;
}

/**
 * `normalizeText`, plus the origin of every character it kept.
 *
 * `sources[i]` is the value supplied with the chunk that produced index `i` of
 * `text`, so a quote found at some offset can be traced back to the utterance
 * it came from — which is what the reading needs in order to say which turn a
 * quote belongs to. Indices are UTF-16 code units, matching `String.indexOf`
 * and `String.slice`, so `sources.length === text.length` always holds.
 */
export function normalizeTracked<T>(
  chunks: readonly { text: string; source: T }[]
): { text: string; sources: T[] } {
  let text = "";
  const sources: T[] = [];
  for (const chunk of chunks) {
    for (const ch of chunk.text.normalize("NFKC")) {
      const normalized = normalizeChar(ch);
      text += normalized;
      for (let i = 0; i < normalized.length; i++) sources.push(chunk.source);
    }
  }
  return { text, sources };
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
