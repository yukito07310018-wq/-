"use client";

interface Props {
  progress: number;
  turn: number;
}

/** §29 — interview progress. Internal element scores are never shown here. */
export default function ProgressIndicator({ progress, turn }: Props) {
  const percent = Math.round(progress * 100);
  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between text-xs text-[color:var(--muted)]">
        <span>{turn} 問目</span>
        <span>モデル構築 {percent}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="診断の進行度"
      >
        <div
          className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
