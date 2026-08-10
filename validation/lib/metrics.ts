/**
 * Statistics used to judge the model as a measurement instrument.
 *
 * These are the standard quantities a reviewer would ask for — correlation with
 * ground truth, bias, RMSE, rank stability, calibration — kept in one place so
 * every experiment reports them the same way.
 */

export function mean(xs: readonly number[]): number {
  return xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function sd(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * Pearson r. Returns NaN when either series is constant — that is a meaningful
 * outcome here (a saturated estimator has zero variance), so it is deliberately
 * not coerced to 0.
 */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length !== ys.length || xs.length < 2) return Number.NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const a = xs[i]! - mx;
    const b = ys[i]! - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? Number.NaN : num / den;
}

/** Average rank, so ties (very common once scores saturate) are handled correctly. */
export function rank(xs: readonly number[]): number[] {
  const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[order[k]!.i] = shared;
    i = j + 1;
  }
  return ranks;
}

export function spearman(xs: readonly number[], ys: readonly number[]): number {
  return pearson(rank(xs), rank(ys));
}

/** Signed mean error: positive means the estimate sits above the truth. */
export function bias(estimate: readonly number[], truth: readonly number[]): number {
  return mean(estimate.map((e, i) => e - truth[i]!));
}

export function rmse(estimate: readonly number[], truth: readonly number[]): number {
  return Math.sqrt(mean(estimate.map((e, i) => (e - truth[i]!) ** 2)));
}

export function absError(estimate: readonly number[], truth: readonly number[]): number[] {
  return estimate.map((e, i) => Math.abs(e - truth[i]!));
}

/** Share of estimates pinned to the 0 or 100 boundary. */
export function saturationRate(estimate: readonly number[], lo = 0, hi = 100): number {
  const pinned = estimate.filter((v) => v <= lo + 1e-9 || v >= hi - 1e-9).length;
  return estimate.length === 0 ? 0 : pinned / estimate.length;
}

export interface CalibrationBin {
  label: string;
  lower: number;
  upper: number;
  count: number;
  meanConfidence: number;
  meanAbsError: number;
}

/**
 * Calibration: bin by reported confidence, then measure the error actually made
 * in each bin.
 *
 * A confidence value earns its name only if error falls as confidence rises. If
 * mean|error| is flat or rising across bins, the number is an evidence counter
 * wearing a statistician's label, and reporting it to a user is misleading.
 */
export function calibration(
  confidence: readonly number[],
  estimate: readonly number[],
  truth: readonly number[],
  edges: readonly number[] = [0, 0.2, 0.4, 0.6, 0.8, 1.0001]
): CalibrationBin[] {
  const errs = absError(estimate, truth);
  const bins: CalibrationBin[] = [];
  for (let b = 0; b < edges.length - 1; b++) {
    const lower = edges[b]!;
    const upper = edges[b + 1]!;
    const idx: number[] = [];
    for (let i = 0; i < confidence.length; i++) {
      const c = confidence[i]!;
      if (c >= lower && c < upper) idx.push(i);
    }
    bins.push({
      label: `${lower.toFixed(1)}–${Math.min(upper, 1).toFixed(1)}`,
      lower,
      upper,
      count: idx.length,
      meanConfidence: idx.length ? mean(idx.map((i) => confidence[i]!)) : Number.NaN,
      meanAbsError: idx.length ? mean(idx.map((i) => errs[i]!)) : Number.NaN,
    });
  }
  return bins;
}

/**
 * ICC(1) — between-persona variance as a share of total.
 *
 * This is the separation question: does the instrument tell two different people
 * apart by more than it disagrees with itself on one person? Near 0 means the
 * output is mostly run-to-run noise.
 */
export function icc1(groups: readonly (readonly number[])[]): number {
  const flat = groups.flat();
  if (flat.length < 2) return Number.NaN;
  const grand = mean(flat);
  const k = mean(groups.map((g) => g.length));
  const n = groups.length;
  if (n < 2 || k < 2) return Number.NaN;

  let ssBetween = 0;
  let ssWithin = 0;
  for (const g of groups) {
    const gm = mean(g);
    ssBetween += g.length * (gm - grand) ** 2;
    for (const v of g) ssWithin += (v - gm) ** 2;
  }
  const msBetween = ssBetween / (n - 1);
  const msWithin = ssWithin / (flat.length - n);
  const den = msBetween + (k - 1) * msWithin;
  return den === 0 ? Number.NaN : (msBetween - msWithin) / den;
}

export function round(value: number, digits = 3): number {
  if (!Number.isFinite(value)) return value;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
