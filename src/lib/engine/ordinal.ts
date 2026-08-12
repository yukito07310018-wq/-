import type { AxisAggregate } from "../types/diagnosis";

/**
 * §31 — turning the model's numbers into claims it can support.
 *
 * `validation/` measured two things that decide how a result may be presented:
 *
 *  - The *ordering* of a person's ten axes is reliable. Axis estimates correlate
 *    r = 0.98 with truth across deliberately different profiles, ICC(1) = 0.78.
 *  - The *magnitude* is not. Real differences arrive compressed by about 3.1×,
 *    so ten axes whose true values span 25–75 are reported inside 39–61. Printing
 *    "AX02: 57 / 100" invites a reading of the gap between 57 and 54 that the
 *    instrument cannot support.
 *
 * So the result screen reports rank, not score. That is not a softer claim
 * dressed up — it is the strongest claim the measurements actually license.
 *
 * Element-level numbers get no ordinal treatment here because they do not
 * survive at all: test-retest r = 0.29 means the same person interviewed twice
 * does not reliably produce the same element ordering either.
 */

/** An axis with no evidence behind it is not ranked; it is reported as unknown. */
export const REPORTABLE_MIN_COVERAGE = 0.1;

export type AxisBand = "high" | "middle" | "low" | "insufficient";

export interface AxisRanking {
  axis_id: string;
  /** 1 = highest of the reportable axes. Null when there is nothing to rank. */
  rank: number | null;
  /** How many axes were rankable at all. */
  outOf: number;
  band: AxisBand;
  /** 0..1 by rank, for drawing. Null when not reportable. */
  relative: number | null;
}

export const BAND_LABEL: Record<AxisBand, string> = {
  high: "相対的に高い",
  middle: "中位",
  low: "相対的に低い",
  insufficient: "情報不足",
};

function bandOf(rank: number, outOf: number): AxisBand {
  if (outOf < 3) return "middle";
  // Floor so the two outer bands stay the same size; the remainder widens the
  // middle, which is where an axis belongs when the ranking cannot separate it.
  const third = Math.floor(outOf / 3);
  if (rank <= third) return "high";
  if (rank > outOf - third) return "low";
  return "middle";
}

/**
 * Ranks the axes against each other, within this one person.
 *
 * The comparison is deliberately intra-personal. There is no norm sample, so
 * "high" can only ever mean "high for you, compared with your other axes" — and
 * saying that plainly is more honest than a 0-100 number that looks like it
 * places someone against a population it was never measured against.
 *
 * Ties share the better rank, so two axes that came out equal are not
 * arbitrarily ordered by whichever floating-point value landed higher.
 */
export function rankAxes(axes: readonly AxisAggregate[]): AxisRanking[] {
  const reportable = axes.filter((a) => a.coverage >= REPORTABLE_MIN_COVERAGE);
  const outOf = reportable.length;

  const sorted = [...reportable].sort((a, b) => b.score - a.score);
  const rankById = new Map<string, number>();
  sorted.forEach((axis, i) => {
    const tiedWithEarlier = sorted.findIndex((other) => other.score === axis.score);
    rankById.set(axis.axis_id, (tiedWithEarlier === -1 ? i : tiedWithEarlier) + 1);
  });

  return axes.map((axis) => {
    const rank = rankById.get(axis.axis_id) ?? null;
    if (rank === null || outOf === 0) {
      return { axis_id: axis.axis_id, rank: null, outOf, band: "insufficient", relative: null };
    }
    return {
      axis_id: axis.axis_id,
      rank,
      outOf,
      band: bandOf(rank, outOf),
      // Evenly spaced by rank: the drawing shows order, and nothing else.
      relative: outOf === 1 ? 1 : 1 - (rank - 1) / (outOf - 1),
    };
  });
}

/** Rank-based radius for the radar, kept off zero so the lowest axis stays visible. */
export function radarRadius(ranking: AxisRanking): number {
  if (ranking.relative === null) return 0;
  return 20 + 80 * ranking.relative;
}
