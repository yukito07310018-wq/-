import elementsFile from "../../../data/elements.json";

/**
 * The bare id list, loaded without Zod so that schemas.ts can depend on it
 * without creating a cycle (elements.ts imports schemas.ts for validation).
 * Full model validation still happens in model/elements.ts at startup.
 */
export const KNOWN_ELEMENT_IDS: ReadonlySet<string> = new Set(
  (elementsFile.elements as { element_id: string }[]).map((e) => e.element_id)
);
