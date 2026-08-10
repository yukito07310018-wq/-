import { ELEMENT_IDS } from "@/lib/model/elements";
import { makeRng, type Rng } from "./rng";

/**
 * A synthetic respondent with *known* trait values.
 *
 * The app can never be validated against a real interview, because nobody knows
 * the true value of "E017 metaphorical thinking" for a real person — there is no
 * answer key. So we invert the problem: invent a person whose 100 trait values
 * we fixed ourselves, let the engine interview them, and check whether it gets
 * the numbers back.
 *
 * This is parameter recovery, the standard way to test whether an estimator is
 * an estimator at all. If a model cannot recover a truth we planted ourselves,
 * it certainly cannot recover one we did not.
 */
export interface Persona {
  id: string;
  label: string;
  /** Ground truth per element, on the same 0-100 scale the app reports. */
  theta: Map<string, number>;
}

/**
 * Ground truth is drawn on the app's own scale, where 50 is "neither" and the
 * distance from 50 is how strongly the trait is present. Values are kept inside
 * 8-92 so that no element's truth is itself at the boundary — otherwise a
 * saturating estimator would look accurate for the wrong reason.
 */
export function makePersona(id: string, label: string, seed: number): Persona {
  const rng = makeRng(seed);
  const theta = new Map<string, number>();
  for (const elementId of ELEMENT_IDS) {
    theta.set(elementId, Math.max(8, Math.min(92, rng.normal(50, 18))));
  }
  return { id, label, theta };
}

/**
 * A persona with a deliberate profile shape: some axes genuinely high, some
 * genuinely low. Used for discriminant validity, where flat random personas
 * would make the task artificially hard.
 */
export function makeShapedPersona(
  id: string,
  label: string,
  seed: number,
  axisBias: Readonly<Record<string, number>>
): Persona {
  const rng = makeRng(seed);
  const theta = new Map<string, number>();
  for (const elementId of ELEMENT_IDS) {
    const axisId = axisIdOf(elementId);
    const bias = axisBias[axisId] ?? 0;
    theta.set(elementId, Math.max(8, Math.min(92, rng.normal(50 + bias, 10))));
  }
  return { id, label, theta };
}

/** E001-E010 → AX01, E011-E020 → AX02 … mirrors data/elements.json. */
function axisIdOf(elementId: string): string {
  const n = Number(elementId.slice(1));
  return `AX${String(Math.floor((n - 1) / 10) + 1).padStart(2, "0")}`;
}

export function truthVector(persona: Persona, elementIds: readonly string[]): number[] {
  return elementIds.map((id) => persona.theta.get(id) ?? 50);
}

/** Independent respondents for Monte-Carlo runs. */
export function makePersonaCohort(size: number, seed: number): Persona[] {
  const rng: Rng = makeRng(seed);
  return Array.from({ length: size }, (_, i) =>
    makePersona(`P${String(i + 1).padStart(3, "0")}`, `persona ${i + 1}`, Math.floor(rng.range(1, 2 ** 30)))
  );
}
