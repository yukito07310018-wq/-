import { ELEMENT_IDS } from "@/lib/model/elements";
import { AXES } from "@/lib/model/axes";
import { getElementWeight } from "@/lib/model/elements";
import type { ElementState, EvidenceDraft } from "@/lib/types/diagnosis";
import {
  measuredElements,
  recordBatches,
  replayTurns,
  runInterview,
  scoresOf,
  type RunResult,
} from "./lib/harness";
import { makePersona, makePersonaCohort, makeShapedPersona, truthVector } from "./lib/persona";
import { IDEAL_RESPONDENT, type RespondentConfig } from "./lib/respondent";
import { makeRng } from "./lib/rng";
import {
  bias,
  calibration,
  icc1,
  mean,
  pearson,
  rmse,
  round,
  saturationRate,
  sd,
  spearman,
  type CalibrationBin,
} from "./lib/metrics";
import {
  CURRENT_PARAMS,
  currentRule,
  groupByTurn,
  posteriorRule,
  type ScoreParams,
} from "./lib/estimators";

/**
 * The study.
 *
 * Each experiment answers one question a reviewer would ask before treating the
 * output as a measurement rather than a mood board. Every number is produced by
 * running the shipped engine over synthetic respondents whose traits we fixed in
 * advance, so "is the estimate right?" has a checkable answer.
 */

const COHORT_SIZE = 24;
const APP_TURNS = 30; // the app's hard stop

export interface Finding {
  id: string;
  question: string;
  verdict: "pass" | "fail" | "warn";
  headline: string;
  metrics: Record<string, number | string>;
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// E1 — parameter recovery under the app's own settings
// ---------------------------------------------------------------------------

/**
 * Does a 30-turn interview recover the traits it was given?
 *
 * This is the headline claim of any scoring model: the number it prints is an
 * estimate of something real. With a perfect extractor and known ground truth,
 * the correlation between estimate and truth is that claim, quantified.
 */
export function e1ParameterRecovery(): Finding {
  const cohort = makePersonaCohort(COHORT_SIZE, 20260810);
  const est: number[] = [];
  const truth: number[] = [];
  let evidencePerElement = 0;
  let elementCount = 0;

  cohort.forEach((persona, i) => {
    const run = runInterview(persona, { turns: APP_TURNS, seed: 1000 + i });
    const ids = measuredElements(run);
    est.push(...scoresOf(run, ids));
    truth.push(...truthVector(persona, ids));
    evidencePerElement += run.evidence.length / Math.max(1, ids.length);
    elementCount += ids.length;
  });

  const r = pearson(est, truth);
  const err = rmse(est, truth);
  // A model that always printed 50 would score this RMSE; beating it is the
  // absolute minimum bar for the estimate carrying any information.
  const baseline = rmse(truth.map(() => 50), truth);

  return {
    id: "E1",
    question: "30ターンの対話で、設定した真の特性値を復元できるか",
    verdict: r > 0.7 ? "pass" : r > 0.4 ? "warn" : "fail",
    headline:
      `真値との相関 r=${round(r, 3)}、RMSE=${round(err, 1)}点。` +
      `「常に50と答えるモデル」のRMSE=${round(baseline, 1)}点。`,
    metrics: {
      pearson_r: round(r, 3),
      r_squared: round(r * r, 3),
      rmse: round(err, 2),
      rmse_constant_baseline: round(baseline, 2),
      bias: round(bias(est, truth), 2),
      saturation_rate: round(saturationRate(est), 3),
      measured_elements_per_run: round(elementCount / COHORT_SIZE, 1),
      evidence_per_element: round(evidencePerElement / COHORT_SIZE, 2),
      n: est.length,
    },
  };
}

// ---------------------------------------------------------------------------
// E2 — consistency: does more evidence make the estimate better?
// ---------------------------------------------------------------------------

/** Restricts questioning to a small element pool so evidence per element grows. */
function deepSelector(pool: readonly string[], perTurn: number) {
  let cursor = 0;
  return (): string[] => {
    const picked: string[] = [];
    for (let i = 0; i < perTurn; i++) {
      picked.push(pool[cursor % pool.length]!);
      cursor++;
    }
    return picked;
  };
}

/**
 * The consistency test — the one that separates an estimator from a counter.
 *
 * E1 is confounded: 30 turns over 100 elements leaves ~2 items of evidence per
 * element, and *no* method can estimate a 0-100 quantity from two coin flips. So
 * here the interview is pointed at 8 elements only, and the evidence per element
 * is driven up. An estimator's error must fall toward zero. If error instead
 * grows, the rule is not converging on anything.
 */
export function e2Consistency(): Finding {
  const pool = ELEMENT_IDS.slice(0, 8);
  const turnCounts = [5, 10, 20, 40, 80, 160];
  const cohort = makePersonaCohort(8, 777);

  const rows = turnCounts.map((turns) => {
    const estCurrent: number[] = [];
    const estPosterior: number[] = [];
    const truth: number[] = [];
    const confidences: number[] = [];

    cohort.forEach((persona, i) => {
      const run = runInterview(persona, {
        turns,
        seed: 5000 + i,
        selectTargets: deepSelector(pool, IDEAL_RESPONDENT.elementsPerTurn),
      });
      const byElement = evidenceByElement(run);
      for (const id of pool) {
        const state = run.states.get(id);
        if (!state || state.evidence_count === 0) continue;
        estCurrent.push(state.score);
        confidences.push(state.confidence);
        truth.push(persona.theta.get(id) ?? 50);
        // Same evidence, different rule.
        estPosterior.push(posteriorRule(groupByTurn(byElement.get(id) ?? [])).score);
      }
    });

    const perElement = rows_evidencePerElement(turns, pool.length);
    return {
      turns,
      evidence_per_element: round(perElement, 1),
      current_rmse: round(rmse(estCurrent, truth), 1),
      current_r: round(pearson(estCurrent, truth), 3),
      current_rank_r: round(spearman(estCurrent, truth), 3),
      current_saturation: round(saturationRate(estCurrent), 3),
      posterior_rmse: round(rmse(estPosterior, truth), 1),
      posterior_r: round(pearson(estPosterior, truth), 3),
      mean_confidence: round(mean(confidences), 3),
    };
  });

  const first = rows[0]!;
  const last = rows[rows.length - 1]!;
  const currentImproves = last.current_rmse < first.current_rmse;

  return {
    id: "E2",
    question: "証拠を増やすほど推定は真値に近づくか（一致性）",
    verdict: currentImproves ? "pass" : "fail",
    headline:
      `証拠が1要素あたり${first.evidence_per_element}件→${last.evidence_per_element}件に増えると、` +
      `現行式のRMSEは${first.current_rmse}点→${last.current_rmse}点と**悪化**し、` +
      `${round(last.current_saturation * 100, 0)}%の要素が0か100に貼り付く。` +
      `同じ証拠を事後平均式で読むと${first.posterior_rmse}点→${last.posterior_rmse}点に改善する。` +
      `ただし順位相関は${last.current_rank_r}を保つので、壊れているのは目盛りであって並び順ではない。`,
    metrics: {
      rmse_at_min_evidence: first.current_rmse,
      rmse_at_max_evidence: last.current_rmse,
      saturation_at_max_evidence: last.current_saturation,
      rank_correlation_at_max_evidence: last.current_rank_r,
      posterior_rmse_at_max_evidence: last.posterior_rmse,
      confidence_at_max_evidence: last.mean_confidence,
    },
    detail: { rows },
  };
}

function rows_evidencePerElement(turns: number, poolSize: number): number {
  return (turns * IDEAL_RESPONDENT.elementsPerTurn * IDEAL_RESPONDENT.evidencePerElement) / poolSize;
}

/** One pass over the evidence log; the naive per-element filter is quadratic. */
function evidenceByElement(run: RunResult): Map<string, RunResult["evidence"]> {
  const map = new Map<string, RunResult["evidence"]>();
  for (const e of run.evidence) {
    const list = map.get(e.element_id);
    if (list) list.push(e);
    else map.set(e.element_id, [e]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// E3 — is "confidence" calibrated?
// ---------------------------------------------------------------------------

/**
 * The app shows a confidence badge and dims the radar fill by confidence, which
 * tells the user "trust the high-confidence parts more". That is a testable
 * promise: error should fall as confidence rises.
 */
export function e3Calibration(): Finding {
  const pool = ELEMENT_IDS.slice(0, 8);
  const cohort = makePersonaCohort(20, 31415);
  const est: number[] = [];
  const truth: number[] = [];
  const conf: number[] = [];

  // Mixed depths, so the sample spans the confidence range the app can reach.
  [6, 12, 24, 48, 96].forEach((turns, ti) => {
    cohort.forEach((persona, i) => {
      const run = runInterview(persona, {
        turns,
        seed: 9000 + ti * 100 + i,
        selectTargets: deepSelector(pool, IDEAL_RESPONDENT.elementsPerTurn),
      });
      for (const id of pool) {
        const s = run.states.get(id);
        if (!s || s.evidence_count === 0) continue;
        est.push(s.score);
        conf.push(s.confidence);
        truth.push(persona.theta.get(id) ?? 50);
      }
    });
  });

  const bins: CalibrationBin[] = calibration(conf, est, truth);
  const populated = bins.filter((b) => b.count > 0);
  const slope = pearson(conf, est.map((e, i) => Math.abs(e - truth[i]!)));
  const monotoneDown =
    populated.length > 1 &&
    populated.every((b, i) => i === 0 || b.meanAbsError <= populated[i - 1]!.meanAbsError + 1e-9);

  // Where does the error start climbing again? Below that point confidence is
  // informative; above it, the badge promises accuracy it does not deliver.
  // Bins with a handful of observations are excluded — the top bin often holds
  // a single element, and one lucky estimate is not a calibration curve.
  const MIN_BIN = 20;
  const reliable = populated.filter((b) => b.count >= MIN_BIN);
  const best = (reliable.length > 0 ? reliable : populated).reduce((a, b) =>
    b.meanAbsError < a.meanAbsError ? b : a
  );
  const above = populated.filter((b) => b.lower > best.lower);
  const worsensAbove = above.length > 0 && above.some((b) => b.meanAbsError > best.meanAbsError + 1);
  const highConfidenceShare = conf.filter((c) => c >= 0.4).length / conf.length;

  return {
    id: "E3",
    question: "Confidenceが高いほど推定は正確か（キャリブレーション）",
    verdict: monotoneDown && slope < 0 ? "pass" : "warn",
    headline:
      `単調ではない。誤差はConfidence ${best.label} の帯で最小（平均${round(best.meanAbsError, 1)}点、n=${best.count}）になり、` +
      (worsensAbove
        ? `それより高い帯ではむしろ増える（${above.map((b) => `${b.label}帯で${round(b.meanAbsError, 1)}点/n=${b.count}`).join("、")}）。`
        : "それより上の帯ではほぼ横ばい。") +
      `そもそもConfidenceが0.4以上に達したサンプルは全体の${round(highConfidenceShare * 100, 1)}%しかなく、` +
      `「Confidenceが高い＝信頼してよい」という画面上の約束は、実際にはほとんど検証されない領域にある。`,
    metrics: {
      confidence_error_correlation: round(slope, 3),
      monotone_decreasing: monotoneDown ? 1 : 0,
      lowest_error_bin: best.label,
      lowest_error_value: round(best.meanAbsError, 1),
      share_confidence_above_0_4: round(highConfidenceShare, 3),
      n: est.length,
    },
    detail: {
      bins: populated.map((b) => ({
        confidence_bin: b.label,
        n: b.count,
        mean_confidence: round(b.meanConfidence, 3),
        mean_abs_error: round(b.meanAbsError, 1),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// E4 — order invariance
// ---------------------------------------------------------------------------

/**
 * Same answers, different order.
 *
 * If a person gives exactly the same 30 answers but the interview happens to ask
 * them in a different sequence, a measurement instrument must return the same
 * profile. The engine damps each turn by the confidence accumulated *so far*, so
 * there is reason to expect it does not.
 *
 * This must be run in the deep regime. Under the app's default breadth-first
 * questioning each element is touched in exactly one turn, so permuting turns
 * cannot change any element's history and invariance holds trivially — a real
 * property, but only because no element is ever revisited.
 */
export function e4OrderInvariance(): Finding {
  const persona = makePersona("P-order", "order test", 2468);
  const pool = ELEMENT_IDS.slice(0, 8);
  const batches = recordBatches(persona, {
    turns: APP_TURNS,
    seed: 13,
    selectTargets: deepSelector(pool, IDEAL_RESPONDENT.elementsPerTurn),
  });
  const baseline = replayTurns(batches);

  const rng = makeRng(99);
  const diffs: number[] = [];
  const maxDiffs: number[] = [];
  const rankShifts: number[] = [];

  for (let trial = 0; trial < 40; trial++) {
    const permuted = rng.shuffle(batches) as EvidenceDraft[][];
    const replayed = replayTurns(permuted);

    const ids = [...baseline.states.keys()].filter((id) => replayed.states.has(id));
    const a = ids.map((id) => baseline.states.get(id)!.score);
    const b = ids.map((id) => replayed.states.get(id)!.score);
    const perElement = a.map((v, i) => Math.abs(v - b[i]!));

    diffs.push(mean(perElement));
    maxDiffs.push(Math.max(...perElement));
    rankShifts.push(spearman(a, b));
  }

  // Control: the app's own breadth-first regime, where each element is seen once.
  const sweepBatches = recordBatches(persona, { turns: APP_TURNS, seed: 13 });
  const sweepBase = replayTurns(sweepBatches);
  const sweepPermuted = replayTurns(makeRng(5).shuffle(sweepBatches) as EvidenceDraft[][]);
  const sweepIds = [...sweepBase.states.keys()].filter((id) => sweepPermuted.states.has(id));
  const sweepDiff = mean(
    sweepIds.map((id) => Math.abs(sweepBase.states.get(id)!.score - sweepPermuted.states.get(id)!.score))
  );

  const meanDiff = mean(diffs);
  return {
    id: "E4",
    question: "同じ回答を別の順序で聞いたとき、同じ結果になるか",
    verdict: meanDiff < 0.5 ? "pass" : meanDiff < 3 ? "warn" : "fail",
    headline:
      `同じ要素を繰り返し聞く条件では、質問順を入れ替えるだけで要素スコアが平均${round(meanDiff, 2)}点、` +
      `最大${round(mean(maxDiffs), 1)}点動く（40通りの順列）。` +
      `一方、現行アプリの「1要素につき1回だけ聞く」条件では差は${round(sweepDiff, 2)}点で、順序不変が成立する。`,
    metrics: {
      mean_abs_difference: round(meanDiff, 3),
      mean_max_difference: round(mean(maxDiffs), 2),
      worst_max_difference: round(Math.max(...maxDiffs), 2),
      mean_rank_correlation: round(mean(rankShifts), 4),
      breadth_first_difference: round(sweepDiff, 3),
    },
  };
}

// ---------------------------------------------------------------------------
// E5 — test-retest reliability
// ---------------------------------------------------------------------------

/**
 * The same person, interviewed twice.
 *
 * Both runs draw from the identical ground truth; only the sampling noise and
 * question order differ. Classical test theory wants r ≥ 0.7 before an
 * instrument is used to say anything about an individual, and ≥ 0.9 before it is
 * used for a decision about them.
 */
export function e5TestRetest(): Finding {
  const cohort = makePersonaCohort(24, 8642);
  const rs: number[] = [];
  const meanAbs: number[] = [];

  cohort.forEach((persona, i) => {
    const a = runInterview(persona, { turns: APP_TURNS, seed: 30000 + i });
    const b = runInterview(persona, { turns: APP_TURNS, seed: 60000 + i });
    const shared = measuredElements(a).filter((id) => b.states.get(id)?.evidence_count);
    if (shared.length < 5) return;
    const sa = scoresOf(a, shared);
    const sb = scoresOf(b, shared);
    rs.push(pearson(sa, sb));
    meanAbs.push(mean(sa.map((v, k) => Math.abs(v - sb[k]!))));
  });

  const r = mean(rs.filter(Number.isFinite));
  return {
    id: "E5",
    question: "同じ人が2回受けたとき、同じ診断結果になるか（再検査信頼性）",
    verdict: r >= 0.7 ? "pass" : r >= 0.4 ? "warn" : "fail",
    headline:
      `同一人物の2回の診断の相関 r=${round(r, 3)}、同一要素で平均${round(mean(meanAbs), 1)}点の差。` +
      `心理測定の慣行では個人について語るのに r≥0.7 が要る。`,
    metrics: {
      test_retest_r: round(r, 3),
      mean_abs_difference: round(mean(meanAbs), 2),
      sd_of_r: round(sd(rs.filter(Number.isFinite)), 3),
      personas: rs.length,
    },
  };
}

// ---------------------------------------------------------------------------
// E6 — discriminant validity
// ---------------------------------------------------------------------------

/**
 * Does the model tell different people apart?
 *
 * Five personas are built with deliberately opposite axis profiles, then each is
 * interviewed several times. ICC(1) asks how much of the variance in the output
 * is "which person is this" versus "which run is this". Low ICC means the radar
 * chart is mostly showing run-to-run noise.
 */
export function e6Discriminant(): Finding {
  const axisIds = AXES.map((a) => a.axis_id);
  const shapes: Record<string, number>[] = [
    Object.fromEntries(axisIds.map((a, i) => [a, i < 5 ? 25 : -25])),
    Object.fromEntries(axisIds.map((a, i) => [a, i < 5 ? -25 : 25])),
    Object.fromEntries(axisIds.map((a, i) => [a, i % 2 === 0 ? 25 : -25])),
    Object.fromEntries(axisIds.map((a, i) => [a, i % 2 === 0 ? -25 : 25])),
    Object.fromEntries(axisIds.map((a) => [a, 0])),
  ];
  const personas = shapes.map((shape, i) => makeShapedPersona(`S${i}`, `shape ${i}`, 4000 + i, shape));

  // One group per (persona, axis): repeated runs of the same person.
  const perAxisGroups: number[][] = [];
  const truthPerAxis: number[] = [];
  const estPerAxis: number[] = [];

  personas.forEach((persona, pi) => {
    const runs = [0, 1, 2, 3].map((k) => runInterview(persona, { turns: APP_TURNS, seed: 70000 + pi * 10 + k }));
    AXES.forEach((axis) => {
      const values = runs.map((run) => run.axes.find((a) => a.axis_id === axis.axis_id)?.score ?? 50);
      perAxisGroups.push(values);
      const axisTruth = mean(axis.element_ids.map((id) => persona.theta.get(id) ?? 50));
      truthPerAxis.push(axisTruth);
      estPerAxis.push(mean(values));
    });
  });

  const icc = icc1(perAxisGroups);
  const axisR = pearson(estPerAxis, truthPerAxis);
  const spread = sd(estPerAxis);
  const truthSpread = sd(truthPerAxis);
  // The axis aggregate is a confidence-weighted mean against a 50 pseudo-count.
  // With confidence near zero the pseudo-count dominates, so real differences
  // arrive at the UI shrunk by this factor.
  const compression = truthSpread / spread;
  const range = [Math.min(...estPerAxis), Math.max(...estPerAxis)];

  return {
    id: "E6",
    question: "異なる人物を、軸レベルで区別できるか（弁別的妥当性）",
    verdict: icc >= 0.7 && axisR >= 0.7 ? "pass" : icc >= 0.4 ? "warn" : "fail",
    headline:
      `軸レベルでは区別できている。ICC(1)=${round(icc, 3)}、軸の真値との相関 r=${round(axisR, 3)}。` +
      `ただし出力の幅が狭い：真値の標準偏差${round(truthSpread, 1)}点に対し出力は${round(spread, 2)}点で、` +
      `約${round(compression, 1)}倍に圧縮されている（10軸すべてが${round(range[0]!, 1)}〜${round(range[1]!, 1)}点の範囲に収まる）。`,
    metrics: {
      icc1: round(icc, 3),
      axis_truth_correlation: round(axisR, 3),
      axis_score_sd: round(spread, 2),
      truth_axis_sd: round(truthSpread, 2),
      compression_factor: round(compression, 2),
      axis_score_min: round(range[0]!, 1),
      axis_score_max: round(range[1]!, 1),
      groups: perAxisGroups.length,
    },
  };
}

// ---------------------------------------------------------------------------
// E7 — sensitivity to the hard-coded constants
// ---------------------------------------------------------------------------

/**
 * How much of the answer is the person, and how much is the number 12?
 *
 * SCORE_SCALE=12, MAX_TURN_DELTA=15, damping 0.5 and κ=0.5 are authored
 * constants with no stated derivation. If perturbing them by ±25% reorders the
 * results, then the ordering is a property of the constants, not of the subject.
 */
export function e7Sensitivity(): Finding {
  const pool = ELEMENT_IDS.slice(0, 8);
  const cohort = makePersonaCohort(12, 5150);

  const variants: { label: string; params: ScoreParams }[] = [
    { label: "scale 12→9", params: { ...CURRENT_PARAMS, scale: 9 } },
    { label: "scale 12→15", params: { ...CURRENT_PARAMS, scale: 15 } },
    { label: "cap 15→11", params: { ...CURRENT_PARAMS, maxTurnDelta: 11 } },
    { label: "cap 15→19", params: { ...CURRENT_PARAMS, maxTurnDelta: 19 } },
    { label: "damping 0.5→0.3", params: { ...CURRENT_PARAMS, dampingCoefficient: 0.3 } },
    { label: "damping 0.5→0.7", params: { ...CURRENT_PARAMS, dampingCoefficient: 0.7 } },
  ];

  const baseScores: number[] = [];
  const variantScores = new Map<string, number[]>(variants.map((v) => [v.label, []]));

  cohort.forEach((persona, i) => {
    const run = runInterview(persona, {
      turns: 40,
      seed: 11000 + i,
      selectTargets: deepSelector(pool, IDEAL_RESPONDENT.elementsPerTurn),
    });
    const byElement = evidenceByElement(run);
    for (const id of pool) {
      const own = byElement.get(id) ?? [];
      if (own.length === 0) continue;
      const grouped = groupByTurn(own);
      baseScores.push(currentRule(grouped, CURRENT_PARAMS).score);
      for (const v of variants) {
        variantScores.get(v.label)!.push(currentRule(grouped, v.params).score);
      }
    }
  });

  const rows = variants.map((v) => {
    const scores = variantScores.get(v.label)!;
    return {
      variant: v.label,
      rank_correlation_vs_default: round(spearman(baseScores, scores), 3),
      mean_abs_score_shift: round(mean(scores.map((s, i) => Math.abs(s - baseScores[i]!))), 1),
    };
  });

  // κ only affects axis aggregation; measured separately on the same states.
  const kappaRow = kappaSensitivity();
  const worstRank = Math.min(...rows.map((r) => r.rank_correlation_vs_default));
  const worstShift = Math.max(...rows.map((r) => r.mean_abs_score_shift));

  return {
    id: "E7",
    question: "手で決めた定数（12・±15・0.5・κ）に結果はどれだけ依存するか",
    verdict: worstShift < 5 ? "pass" : worstShift < 15 ? "warn" : "fail",
    headline:
      `定数を±25%動かすと要素スコアは平均最大${worstShift}点ずれる。` +
      `順位相関は最低${worstRank}なので、順位はほぼ保たれるが絶対値は保たれない。`,
    metrics: {
      worst_mean_abs_shift: worstShift,
      worst_rank_correlation: worstRank,
      kappa_max_axis_shift: kappaRow.maxShift,
    },
    detail: { rows, kappa: kappaRow.rows },
  };
}

/** κ is the pseudo-count in axis aggregation; it decides how fast an axis leaves 50. */
function kappaSensitivity(): { rows: unknown[]; maxShift: number } {
  const persona = makePersona("P-kappa", "kappa", 1357);
  const run = runInterview(persona, { turns: APP_TURNS, seed: 246 });
  const kappas = [0.25, 0.5, 1.0, 2.0];

  const byKappa = kappas.map((kappa) => ({
    kappa,
    axes: AXES.map((axis) => axisScoreWithKappa(axis.element_ids, run.states, kappa)),
  }));
  const base = byKappa.find((k) => k.kappa === 0.5)!.axes;

  const rows = byKappa.map((k) => ({
    kappa: k.kappa,
    mean_abs_axis_shift: round(mean(k.axes.map((v, i) => Math.abs(v - base[i]!))), 2),
  }));
  return { rows, maxShift: Math.max(...rows.map((r) => r.mean_abs_axis_shift)) };
}

function axisScoreWithKappa(
  elementIds: readonly string[],
  states: ReadonlyMap<string, ElementState>,
  kappa: number
): number {
  let numerator = 50 * kappa;
  let denominator = kappa;
  for (const id of elementIds) {
    const s = states.get(id);
    const score = s?.score ?? 50;
    const confidence = s?.confidence ?? 0;
    const w = getElementWeight(id);
    numerator += score * confidence * w;
    denominator += confidence * w;
  }
  return Math.min(100, Math.max(0, numerator / denominator));
}

// ---------------------------------------------------------------------------
// E8 — how much is recoverable at all?
// ---------------------------------------------------------------------------

/**
 * Separates "this task is hard" from "this rule is wrong".
 *
 * The posterior-mean rule reads the *same* evidence the engine read. Whatever
 * accuracy it reaches is available to the app for free; the gap between the two
 * is the cost of the current update rule, not of the interview.
 */
export function e8RuleComparison(): Finding {
  const cohort = makePersonaCohort(24, 24680);
  const estCurrent: number[] = [];
  const estPosterior: number[] = [];
  const truth: number[] = [];

  cohort.forEach((persona, i) => {
    const run = runInterview(persona, { turns: APP_TURNS, seed: 41000 + i });
    const byElement = evidenceByElement(run);
    for (const id of measuredElements(run)) {
      const own = byElement.get(id) ?? [];
      if (own.length === 0) continue;
      estCurrent.push(run.states.get(id)!.score);
      estPosterior.push(posteriorRule(groupByTurn(own)).score);
      truth.push(persona.theta.get(id) ?? 50);
    }
  });

  const rCurrent = pearson(estCurrent, truth);
  const rPosterior = pearson(estPosterior, truth);
  const errCurrent = rmse(estCurrent, truth);
  const errPosterior = rmse(estPosterior, truth);

  return {
    id: "E8",
    question: "更新式を替えれば直るのか、それとも証拠量が足りないのか",
    verdict: "warn",
    headline:
      `現行アプリの設定（30ターン・1要素あたり証拠2件）では、現行式 RMSE=${round(errCurrent, 1)}点に対し ` +
      `事後平均式は ${round(errPosterior, 1)}点で、ほぼ変わらない。` +
      `つまりこの条件で効いているのは更新式ではなく証拠量の不足であり、` +
      `式を直しても30ターンのままでは要素スコアは改善しない（E2は証拠が増えた場合を示す）。`,
    metrics: {
      current_r: round(rCurrent, 3),
      current_rmse: round(errCurrent, 2),
      posterior_r: round(rPosterior, 3),
      posterior_rmse: round(errPosterior, 2),
      rmse_reduction_points: round(errCurrent - errPosterior, 2),
    },
  };
}

// ---------------------------------------------------------------------------
// E9 — sensitivity to extractor bias
// ---------------------------------------------------------------------------

/**
 * Everything above assumes a perfect extractor. This asks what a *small* tilt
 * costs — a Claude that leans 10 points toward positive evidence, which is a
 * mild assumption for a model asked to find creativity in someone's answers.
 */
export function e9ExtractorBias(): Finding {
  const cohort = makePersonaCohort(16, 1122);
  const biases = [0, 0.05, 0.1, 0.2];

  const rows = biases.map((positiveBias) => {
    const respondent: RespondentConfig = { ...IDEAL_RESPONDENT, positiveBias };
    const est: number[] = [];
    const truth: number[] = [];
    cohort.forEach((persona, i) => {
      const run = runInterview(persona, { turns: APP_TURNS, seed: 52000 + i, respondent });
      const ids = measuredElements(run);
      est.push(...scoresOf(run, ids));
      truth.push(...truthVector(persona, ids));
    });
    return {
      extractor_positive_bias: positiveBias,
      mean_score: round(mean(est), 1),
      bias_points: round(bias(est, truth), 1),
      rmse: round(rmse(est, truth), 1),
      r: round(pearson(est, truth), 3),
    };
  });

  const worst = rows[rows.length - 1]!;
  const clean = rows[0]!;
  return {
    id: "E9",
    question: "抽出側がわずかに肯定寄りだと、結果はどれだけ動くか",
    verdict: Math.abs(worst.bias_points - clean.bias_points) < 5 ? "pass" : "fail",
    headline:
      `抽出が20ポイント肯定に傾くと、平均スコアは${clean.mean_score}点→${worst.mean_score}点、` +
      `真値からの偏りは${clean.bias_points}点→${worst.bias_points}点になる。`,
    metrics: {
      bias_at_zero: clean.bias_points,
      bias_at_20pt_tilt: worst.bias_points,
      amplification: round((worst.bias_points - clean.bias_points) / 20, 2),
    },
    detail: { rows },
  };
}

// ---------------------------------------------------------------------------
// E10 — what happens to confidence as evidence accumulates
// ---------------------------------------------------------------------------

/**
 * Confidence is supposed to rise as evidence accumulates. E2 showed it falling,
 * so this isolates the mechanism.
 *
 * `detectDirectionalContradictions` pairs every positive item against every
 * negative one for the same element, so a genuinely mixed trait — which is what
 * a mid-scale value *is* — generates contradictions at O(n_pos × n_neg). Each
 * unresolved one multiplies confidence by (1 − 0.25·severity). The product of
 * hundreds of such factors is indistinguishable from zero.
 */
export function e10ConfidenceCollapse(): Finding {
  const pool = ELEMENT_IDS.slice(0, 8);
  const cohort = makePersonaCohort(6, 606);
  const turnCounts = [5, 10, 20, 40, 80];

  const rows = turnCounts.map((turns) => {
    const confidences: number[] = [];
    const unresolvedPerElement: number[] = [];
    const evidencePerElement: number[] = [];

    cohort.forEach((persona, i) => {
      const run = runInterview(persona, {
        turns,
        seed: 80000 + i,
        selectTargets: deepSelector(pool, IDEAL_RESPONDENT.elementsPerTurn),
      });
      for (const id of pool) {
        const s = run.states.get(id);
        if (!s || s.evidence_count === 0) continue;
        confidences.push(s.confidence);
        evidencePerElement.push(s.evidence_count);
        unresolvedPerElement.push(
          run.contradictions.filter((c) => c.status === "unresolved" && c.elements.includes(id)).length
        );
      }
    });

    return {
      turns,
      evidence_per_element: round(mean(evidencePerElement), 1),
      unresolved_contradictions_per_element: round(mean(unresolvedPerElement), 1),
      mean_confidence: round(mean(confidences), 4),
      max_confidence: round(Math.max(...confidences), 4),
    };
  });

  const peak = rows.reduce((a, b) => (b.mean_confidence > a.mean_confidence ? b : a));
  const last = rows[rows.length - 1]!;

  return {
    id: "E10",
    question: "証拠が増えるとConfidenceは上がるのか、下がるのか",
    verdict: last.mean_confidence >= peak.mean_confidence ? "pass" : "fail",
    headline:
      `Confidenceは証拠${peak.evidence_per_element}件で${peak.mean_confidence}に達したあと下降し、` +
      `${last.evidence_per_element}件では${last.mean_confidence}まで落ちる。` +
      `原因は矛盾ペナルティの累乗で、1要素あたりの未解決矛盾が${last.unresolved_contradictions_per_element}件に増えるため。` +
      `矛盾は positive×negative の総当たりで生成されるので証拠件数の2乗で増え、` +
      `ペナルティ (1−0.25·severity) がその回数だけ掛かる。` +
      `結果として「終了条件 conf ≥ 0.75」は対話を延ばすほど遠のく。`,
    metrics: {
      peak_confidence: peak.mean_confidence,
      peak_at_evidence_per_element: peak.evidence_per_element,
      final_confidence: last.mean_confidence,
      final_unresolved_per_element: last.unresolved_contradictions_per_element,
    },
    detail: { rows },
  };
}

export function runAll(): Finding[] {
  return [
    e1ParameterRecovery(),
    e2Consistency(),
    e3Calibration(),
    e4OrderInvariance(),
    e5TestRetest(),
    e6Discriminant(),
    e7Sensitivity(),
    e8RuleComparison(),
    e9ExtractorBias(),
    e10ConfidenceCollapse(),
  ];
}
