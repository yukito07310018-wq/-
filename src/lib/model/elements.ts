import elementsFile from "../../../data/elements.json";
import { ElementsFileSchema } from "../validation/schemas";
import type { ElementDefinition } from "../types/diagnosis";

/**
 * Loads and validates the 100-element model at module import time.
 * A malformed model is a fatal condition: the whole diagnosis is meaningless
 * without it, so we throw rather than degrade (§7).
 */
function loadElements(): ElementDefinition[] {
  const parsed = ElementsFileSchema.safeParse(elementsFile);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `data/elements.json の検証に失敗しました。要素モデルが壊れているため起動できません。\n${issues}`
    );
  }
  return parsed.data.elements;
}

export const ELEMENTS: ElementDefinition[] = loadElements();

export const ELEMENT_IDS: string[] = ELEMENTS.map((e) => e.element_id);


const BY_ID = new Map<string, ElementDefinition>(ELEMENTS.map((e) => [e.element_id, e]));

export function getElement(elementId: string): ElementDefinition | undefined {
  return BY_ID.get(elementId);
}

export function requireElement(elementId: string): ElementDefinition {
  const e = BY_ID.get(elementId);
  if (!e) throw new Error(`unknown element_id: ${elementId}`);
  return e;
}

export function isKnownElement(elementId: string): boolean {
  return BY_ID.has(elementId);
}

export function getElementWeight(elementId: string): number {
  return BY_ID.get(elementId)?.weight ?? 1.0;
}

/** Max authored weight — used to normalise weights into 0..1 for QValue (§17). */
export const MAX_ELEMENT_WEIGHT = 1.5;

export function normalizedWeight(elementId: string): number {
  return getElementWeight(elementId) / MAX_ELEMENT_WEIGHT;
}

export function elementsOfAxis(axisId: string): ElementDefinition[] {
  return ELEMENTS.filter((e) => e.axis_id === axisId);
}

/** Elements considered "near" a given element for contradiction scoping (§13.2b). */
export function neighbourhoodOf(elementId: string): Set<string> {
  const e = BY_ID.get(elementId);
  if (!e) return new Set();
  return new Set([...e.related_elements, ...e.contrast_elements]);
}
