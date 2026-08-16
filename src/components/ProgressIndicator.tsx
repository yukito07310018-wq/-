"use client";

interface Props {
  progress: number;
  turn: number;
  maxTurns: number;
}

/**
 * §29 — how far through the interview we are, and nothing else.
 *
 * It used to read 「モデル構築 N%」 off a blend of turn count, mean confidence and
 * coverage. Two of those three are no longer computed during the interview, and
 * describing an interview in progress as a model being built was never true for
 * the user's benefit anyway.
 */
export default function ProgressIndicator({ progress, turn, maxTurns }: Props) {
  const percent = Math.round(progress * 100);
  return (
    <div className="w-full">
      <div className="mb-2 flex items-baseline justify-between text-xs text-[color:var(--muted)]">
        <span>{turn} 問目</span>
        <span>最大 {maxTurns} 問</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--surface-2)]"
        role="progressbar"
        aria-valuenow={turn}
        aria-valuemin={0}
        aria-valuemax={maxTurns}
        aria-label="対話の進行度"
      >
        <div
          className="h-full rounded-full bg-[color:var(--accent)] transition-all duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
