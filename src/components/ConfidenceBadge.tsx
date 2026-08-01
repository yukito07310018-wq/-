"use client";

/**
 * §30 — a confident-looking number with no evidence behind it is the main way
 * this kind of product misleads people. Low confidence is always marked.
 */

export const LOW_CONFIDENCE_THRESHOLD = 0.4;
export const UNCERTAIN_THRESHOLD = 0.5;

interface Props {
  confidence: number;
  className?: string;
}

export default function ConfidenceBadge({ confidence, className = "" }: Props) {
  const low = confidence < LOW_CONFIDENCE_THRESHOLD;
  const label = low ? "情報不足" : confidence < 0.7 ? "参考値" : "確からしさ 高";
  const tone = low
    ? "border-amber-700/60 bg-amber-950/40 text-amber-200"
    : confidence < 0.7
      ? "border-[color:var(--border)] bg-[color:var(--surface-2)] text-[color:var(--muted)]"
      : "border-sky-800/60 bg-sky-950/40 text-sky-200";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs ${tone} ${className}`}
      title={`Confidence ${confidence.toFixed(2)}`}
    >
      {label}
      <span className="opacity-70">{confidence.toFixed(2)}</span>
    </span>
  );
}
