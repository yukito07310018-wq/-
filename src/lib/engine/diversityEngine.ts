import { EVIDENCE_TYPE_COUNT } from "../types/diagnosis";
import type { Evidence } from "../types/diagnosis";

/**
 * §12 — evidence diversity as the normalised entropy of the evidence-type
 * distribution. "self_description ×3" scores low; a spread across experience,
 * decision, failure and relationship scores high.
 */
export function evidenceDiversity(evidence: readonly Pick<Evidence, "type">[]): number {
  const n = evidence.length;
  if (n <= 1) return 0;

  const counts = new Map<string, number>();
  for (const e of evidence) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);

  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / n;
    entropy -= p * Math.log(p);
  }

  const hMax = Math.log(Math.min(n, EVIDENCE_TYPE_COUNT));
  if (hMax === 0) return 0;
  return clamp01(entropy / hMax);
}

/** Distinct evidence types present, preserving first-seen order. */
export function evidenceTypeSet(evidence: readonly Pick<Evidence, "type">[]): string[] {
  const seen: string[] = [];
  for (const e of evidence) if (!seen.includes(e.type)) seen.push(e.type);
  return seen;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
