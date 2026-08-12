import { describe, expect, it } from "vitest";
import { radarRadius, rankAxes, REPORTABLE_MIN_COVERAGE } from "@/lib/engine/ordinal";
import type { AxisAggregate } from "@/lib/types/diagnosis";

/** §31 — the result screen reports rank, because rank is what the model supports. */

function axis(id: string, score: number, coverage = 1, confidence = 0.5): AxisAggregate {
  return { axis_id: id, name: id, score, confidence, coverage };
}

describe("rankAxes", () => {
  it("ranks highest score first", () => {
    const ranked = rankAxes([axis("A", 40), axis("B", 60), axis("C", 50)]);
    expect(ranked.find((r) => r.axis_id === "B")!.rank).toBe(1);
    expect(ranked.find((r) => r.axis_id === "C")!.rank).toBe(2);
    expect(ranked.find((r) => r.axis_id === "A")!.rank).toBe(3);
  });

  it("gives tied axes the same rank", () => {
    // Two axes that came out equal must not be ordered by whichever float won.
    const ranked = rankAxes([axis("A", 55), axis("B", 55), axis("C", 40)]);
    expect(ranked.find((r) => r.axis_id === "A")!.rank).toBe(1);
    expect(ranked.find((r) => r.axis_id === "B")!.rank).toBe(1);
    expect(ranked.find((r) => r.axis_id === "C")!.rank).toBe(3);
  });

  it("excludes axes with no evidence and marks them insufficient", () => {
    const ranked = rankAxes([axis("A", 60), axis("B", 50, 0), axis("C", 40)]);
    const b = ranked.find((r) => r.axis_id === "B")!;
    expect(b.rank).toBeNull();
    expect(b.band).toBe("insufficient");
    expect(b.relative).toBeNull();
    // …and the remaining axes are ranked among themselves only.
    expect(ranked.find((r) => r.axis_id === "A")!.outOf).toBe(2);
  });

  it("reports every axis as insufficient when nothing was measured", () => {
    const ranked = rankAxes([axis("A", 50, 0), axis("B", 50, 0)]);
    expect(ranked.every((r) => r.band === "insufficient")).toBe(true);
    expect(ranked.every((r) => r.rank === null)).toBe(true);
  });

  it("splits ten axes into thirds", () => {
    const axes = Array.from({ length: 10 }, (_, i) => axis(`A${i}`, 100 - i * 5));
    const ranked = rankAxes(axes);
    const bands = ranked.map((r) => r.band);
    expect(bands.filter((b) => b === "high")).toHaveLength(3);
    expect(bands.filter((b) => b === "low")).toHaveLength(3);
    expect(bands.filter((b) => b === "middle")).toHaveLength(4);
  });

  it("depends only on order, not on the size of the gaps", () => {
    // The compression measured in E6 means gaps are not trustworthy; identical
    // orderings must therefore produce identical output.
    const wide = rankAxes([axis("A", 90), axis("B", 50), axis("C", 10)]);
    const narrow = rankAxes([axis("A", 51), axis("B", 50), axis("C", 49)]);
    expect(narrow.map((r) => r.rank)).toEqual(wide.map((r) => r.rank));
    expect(narrow.map((r) => r.relative)).toEqual(wide.map((r) => r.relative));
  });

  it("honours the coverage threshold", () => {
    const justUnder = rankAxes([axis("A", 60, REPORTABLE_MIN_COVERAGE - 0.01), axis("B", 50)]);
    expect(justUnder.find((r) => r.axis_id === "A")!.band).toBe("insufficient");

    const justOver = rankAxes([axis("A", 60, REPORTABLE_MIN_COVERAGE), axis("B", 50)]);
    expect(justOver.find((r) => r.axis_id === "A")!.rank).toBe(1);
  });
});

describe("radarRadius", () => {
  it("keeps the lowest-ranked axis visible", () => {
    const ranked = rankAxes(Array.from({ length: 10 }, (_, i) => axis(`A${i}`, 100 - i * 5)));
    const radii = ranked.map(radarRadius);
    expect(Math.min(...radii)).toBeGreaterThan(0);
    expect(Math.max(...radii)).toBeLessThanOrEqual(100);
  });

  it("draws an unmeasured axis at the centre", () => {
    const [only] = rankAxes([axis("A", 50, 0)]);
    expect(radarRadius(only)).toBe(0);
  });
});
