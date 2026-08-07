import type { QuestionSource, TurnDiagnosticRecord } from "../db/repository";

/**
 * Turns the per-turn diagnostics into a verdict on whether evidence extraction
 * is actually working (§36).
 *
 * Every LLM call in the loop is fail-soft, which keeps the interview alive
 * during an outage but makes an outage look exactly like an uninformative
 * conversation: both end at zero evidence. This classifies which one happened,
 * so the result screen can say so instead of silently reporting "情報不足".
 *
 * Pure function, no I/O — the same reason the rest of the engine is testable.
 */

export type ExtractionStatus =
  /** No turns processed yet. */
  | "no_data"
  /** Working — evidence is being accepted. */
  | "ok"
  /** Call A itself is failing: API key, model id, connectivity or timeout. */
  | "analyst_down"
  /** Call A answers, but its quotes do not match what the user actually wrote. */
  | "quotes_ungrounded"
  /** Call A answers and quotes verify, but the answers carry little to extract. */
  | "sparse_answers";

/** A failure has to persist across this many recent turns before we call it degraded. */
export const DEGRADED_WINDOW = 3;
export const DEGRADED_MIN_FAILURES = 2;

export interface ExtractionHealth {
  status: ExtractionStatus;
  turnsRecorded: number;
  analystFailures: number;
  turnsWithZeroAccepted: number;
  totalExtracted: number;
  totalAccepted: number;
  totalRejected: number;
  rejectedReasons: Record<string, number>;
  repairedTurns: number;
  /** Turns whose question did not come from Call B — a Call B outage in disguise. */
  nonLlmQuestions: number;
  /** True when the recent window is failing, not just one unlucky turn. */
  degraded: boolean;
}

export function emptyExtractionHealth(): ExtractionHealth {
  return {
    status: "no_data",
    turnsRecorded: 0,
    analystFailures: 0,
    turnsWithZeroAccepted: 0,
    totalExtracted: 0,
    totalAccepted: 0,
    totalRejected: 0,
    rejectedReasons: {},
    repairedTurns: 0,
    nonLlmQuestions: 0,
    degraded: false,
  };
}

function isNonLlmQuestion(source: QuestionSource): boolean {
  return source === "fallback" || source === "exhausted";
}

export function assessExtraction(
  diagnostics: readonly TurnDiagnosticRecord[]
): ExtractionHealth {
  if (diagnostics.length === 0) return emptyExtractionHealth();

  const health = emptyExtractionHealth();
  health.turnsRecorded = diagnostics.length;

  for (const d of diagnostics) {
    if (!d.analystOk) health.analystFailures += 1;
    if (d.accepted === 0) health.turnsWithZeroAccepted += 1;
    if (d.repaired) health.repairedTurns += 1;
    if (isNonLlmQuestion(d.questionSource)) health.nonLlmQuestions += 1;
    health.totalExtracted += d.extracted;
    health.totalAccepted += d.accepted;
    health.totalRejected += d.rejected;
    for (const [reason, count] of Object.entries(d.rejectedReasons)) {
      health.rejectedReasons[reason] = (health.rejectedReasons[reason] ?? 0) + count;
    }
  }

  const recent = diagnostics.slice(-DEGRADED_WINDOW);
  const recentFailures = recent.filter((d) => !d.analystOk || d.accepted === 0);
  health.degraded = recentFailures.length >= Math.min(DEGRADED_MIN_FAILURES, recent.length);

  // Once things are failing, the failing turns describe the situation better
  // than the lifetime totals: an interview that worked for four turns and then
  // lost its API key is not "ok" just because it banked evidence early.
  health.status = classify(health.degraded ? recentFailures : diagnostics);
  return health;
}

/** Classifies a set of turns by its own aggregates. */
function classify(rows: readonly TurnDiagnosticRecord[]): ExtractionStatus {
  if (rows.length === 0) return "no_data";

  let failures = 0;
  let accepted = 0;
  let rejected = 0;
  let extracted = 0;
  for (const d of rows) {
    if (!d.analystOk) failures += 1;
    accepted += d.accepted;
    rejected += d.rejected;
    extracted += d.extracted;
  }

  if (accepted > 0) return "ok";

  // Call A never returned at all for a meaningful share of these turns.
  if (failures * 2 >= rows.length) return "analyst_down";

  // Call A returned items, but verification threw them all away.
  if (rejected > 0) return "quotes_ungrounded";

  // Call A returned nothing to verify: the answers themselves carried little.
  if (extracted === 0) return "sparse_answers";

  return "ok";
}

/** One-line Japanese explanation for the result screen. */
export function describeExtraction(health: ExtractionHealth): string | null {
  switch (health.status) {
    case "analyst_down":
      return "会話の読み取り処理（Evidence抽出）が失敗しています。診断結果ではなくシステム側の問題です。APIキー・モデル設定・接続を確認してください。";
    case "quotes_ungrounded":
      return "読み取りは動いていますが、引用の照合にすべて失敗しています。抽出された根拠が実際の発言と一致しないため破棄されました。";
    case "sparse_answers":
      return "読み取りは正常に動いていますが、今回の回答からは根拠を取り出せませんでした。具体的な出来事や行動を含めて話すと、根拠が集まりやすくなります。";
    case "ok":
    case "no_data":
      return null;
  }
}
