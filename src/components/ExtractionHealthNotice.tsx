import { describeExtraction, type ExtractionHealth } from "@/lib/engine/extractionHealth";

/**
 * §36 — says out loud when a low-confidence result is the pipeline's fault.
 *
 * Without this, an AI outage and a genuinely thin conversation produce the same
 * screen ("情報不足", coverage 0%), and the user reads a system failure as a
 * statement about themselves. That is the one misreading this app must not
 * allow, so the distinction is shown rather than left in the server log.
 */

const TONE: Record<string, { border: string; bg: string; text: string; label: string }> = {
  analyst_down: {
    border: "border-red-900/60",
    bg: "bg-red-950/40",
    text: "text-red-200",
    label: "システムエラー",
  },
  quotes_ungrounded: {
    border: "border-amber-900/60",
    bg: "bg-amber-950/40",
    text: "text-amber-200",
    label: "引用の照合に失敗",
  },
  sparse_answers: {
    border: "border-[color:var(--border)]",
    bg: "bg-[color:var(--surface-2)]",
    text: "text-[color:var(--muted)]",
    label: "根拠が集まっていません",
  },
};

export default function ExtractionHealthNotice({ health }: { health: ExtractionHealth }) {
  const message = describeExtraction(health);
  if (!message) return null;

  const tone = TONE[health.status] ?? TONE.sparse_answers;
  const rejected = Object.entries(health.rejectedReasons).filter(([, n]) => n > 0);

  return (
    <section className={`rounded-xl border ${tone.border} ${tone.bg} p-4 text-sm`}>
      <p className={`font-semibold ${tone.text}`}>{tone.label}</p>
      <p className={`mt-2 leading-relaxed ${tone.text}`}>{message}</p>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[color:var(--muted)]">
        <div className="flex gap-1">
          <dt>記録ターン</dt>
          <dd className="tabular-nums">{health.turnsRecorded}</dd>
        </div>
        <div className="flex gap-1">
          <dt>抽出</dt>
          <dd className="tabular-nums">{health.totalExtracted}</dd>
        </div>
        <div className="flex gap-1">
          <dt>採用</dt>
          <dd className="tabular-nums">{health.totalAccepted}</dd>
        </div>
        <div className="flex gap-1">
          <dt>破棄</dt>
          <dd className="tabular-nums">{health.totalRejected}</dd>
        </div>
        {health.analystFailures > 0 && (
          <div className="flex gap-1">
            <dt>抽出呼び出しの失敗</dt>
            <dd className="tabular-nums">{health.analystFailures}</dd>
          </div>
        )}
        {health.nonLlmQuestions > 0 && (
          <div className="flex gap-1">
            <dt>定型質問で代替</dt>
            <dd className="tabular-nums">{health.nonLlmQuestions}</dd>
          </div>
        )}
      </dl>

      {rejected.length > 0 && (
        <p className="mt-2 text-xs text-[color:var(--muted)]">
          破棄の内訳: {rejected.map(([reason, n]) => `${reason} ${n}`).join(" / ")}
        </p>
      )}
    </section>
  );
}
