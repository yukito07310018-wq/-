import axesFile from "../../../data/axes.json";
import { AxesFileSchema } from "../validation/schemas";
import type { AxisDefinition } from "../types/diagnosis";
import { ELEMENTS } from "./elements";

function loadAxes(): AxisDefinition[] {
  const parsed = AxesFileSchema.safeParse(axesFile);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`data/axes.json の検証に失敗しました。\n${issues}`);
  }
  const axes = parsed.data.axes;

  // Cross-check against the element file: each axis must own exactly its 10 elements.
  for (const axis of axes) {
    const owned = ELEMENTS.filter((e) => e.axis_id === axis.axis_id).map((e) => e.element_id);
    const sameSet =
      owned.length === axis.element_ids.length && owned.every((id) => axis.element_ids.includes(id));
    if (!sameSet) {
      throw new Error(
        `axes.json と elements.json が不整合です: ${axis.axis_id} (elements.json=${owned.length}件)`
      );
    }
  }
  return axes;
}

export const AXES: AxisDefinition[] = loadAxes();

export const AXIS_IDS: string[] = AXES.map((a) => a.axis_id);

const BY_ID = new Map<string, AxisDefinition>(AXES.map((a) => [a.axis_id, a]));

export function getAxis(axisId: string): AxisDefinition | undefined {
  return BY_ID.get(axisId);
}

export function axisNameOf(axisId: string): string {
  return BY_ID.get(axisId)?.name ?? axisId;
}

const AXIS_OF_ELEMENT = new Map<string, string>(ELEMENTS.map((e) => [e.element_id, e.axis_id]));

export function axisOfElement(elementId: string): string | undefined {
  return AXIS_OF_ELEMENT.get(elementId);
}

/**
 * The axis a question primarily targets: the axis holding the most of its
 * target elements (ties broken by axis id for determinism). Used by the
 * diversity term in §17.
 */
export function primaryAxisOf(elementIds: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const id of elementIds) {
    const axis = AXIS_OF_ELEMENT.get(id);
    if (!axis) continue;
    counts.set(axis, (counts.get(axis) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const axisId of AXIS_IDS) {
    const c = counts.get(axisId) ?? 0;
    if (c > bestCount) {
      best = axisId;
      bestCount = c;
    }
  }
  return best;
}
