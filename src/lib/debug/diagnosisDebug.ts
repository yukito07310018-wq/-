import { KNOWN_ELEMENT_IDS } from "../model/elementIds";

/**
 * Diagnostic instrumentation for the evidence pipeline.
 *
 * Nothing here changes behaviour: it only prints what each stage of
 * Call A → schema → quote verification → persistence actually received and
 * produced, so a run that ends with "evidence 0" can be attributed to a stage
 * instead of guessed at.
 *
 * Enabled when DIAGNOSIS_DEBUG=1, or outside production by default.
 * The raw model output contains the user's own words, so it is only logged
 * while this flag is on.
 */

export function diagnosisDebugEnabled(): boolean {
  const flag = process.env.DIAGNOSIS_DEBUG?.trim();
  if (flag === "1" || flag === "true") return true;
  if (flag === "0" || flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

export function debugLog(scope: string, message: string, detail?: unknown): void {
  if (!diagnosisDebugEnabled()) return;
  if (detail === undefined) {
    console.log(`[debug:${scope}] ${message}`);
    return;
  }
  console.log(
    `[debug:${scope}] ${message} ${
      typeof detail === "string" ? detail : JSON.stringify(detail, null, 2)
    }`
  );
}

/** Prints a long string whole, so a truncated model reply is visible as truncated. */
export function debugRaw(scope: string, label: string, raw: string): void {
  if (!diagnosisDebugEnabled()) return;
  console.log(
    `[debug:${scope}] ${label} (chars=${raw.length}, endsWith=${JSON.stringify(raw.slice(-24))})\n${raw}`
  );
}

export interface ElementIdReconciliation {
  items: number;
  /** element_id present, id-shaped (E000) and present in the 100-element master. */
  known: number;
  /** id-shaped but absent from the master, e.g. E101. */
  unknownIdShaped: string[];
  /** Not id-shaped at all, e.g. a Japanese element name. */
  notIdShaped: string[];
  /** element_id missing or not a string. */
  missing: number;
}

const ID_SHAPE = /^E\d{3}$/;

/**
 * The element_id reconciliation that the strict schema performs implicitly.
 *
 * EvidenceItemSchema rejects an unknown element_id, and because the items live
 * in an array inside one object, a single bad id fails the *whole* response —
 * so "how many ids matched" is not otherwise observable anywhere.
 */
export function reconcileElementIds(parsed: unknown): ElementIdReconciliation {
  const result: ElementIdReconciliation = {
    items: 0,
    known: 0,
    unknownIdShaped: [],
    notIdShaped: [],
    missing: 0,
  };

  const evidence = (parsed as { evidence?: unknown })?.evidence;
  if (!Array.isArray(evidence)) return result;

  result.items = evidence.length;
  for (const item of evidence) {
    const id = (item as { element_id?: unknown })?.element_id;
    if (typeof id !== "string" || id.length === 0) {
      result.missing += 1;
    } else if (!ID_SHAPE.test(id)) {
      result.notIdShaped.push(id);
    } else if (!KNOWN_ELEMENT_IDS.has(id)) {
      result.unknownIdShaped.push(id);
    } else {
      result.known += 1;
    }
  }

  return result;
}
