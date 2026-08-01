"use client";

import ConfidenceBadge, { UNCERTAIN_THRESHOLD } from "./ConfidenceBadge";
import type { AxisInsight } from "@/lib/interview/profileService";

/**
 * §31 — per-axis explanation.
 * Wording is deliberately provisional ("傾向が見えています", never "あなたは○○な人です").
 */

interface Props {
  axis: AxisInsight;
}

export default function ElementInsight({ axis }: Props) {
  const uncertain = axis.confidence < UNCERTAIN_THRESHOLD;

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{axis.name}</h3>
        <ConfidenceBadge confidence={axis.confidence} />
      </div>

      <p className="mt-1 text-xs text-[color:var(--muted)]">{axis.description}</p>

      <div className="mt-4 flex items-baseline gap-4">
        <span className="text-3xl font-bold tabular-nums">{axis.score.toFixed(0)}</span>
        <span className="text-sm text-[color:var(--muted)]">/ 100</span>
        <span className="ml-auto text-xs text-[color:var(--muted)]">
          この軸の10要素のうち {Math.round(axis.coverage * 10)} 要素に根拠あり
        </span>
      </div>

      {uncertain ? (
        <p className="mt-4 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          この軸については、まだ判断材料が足りません。表示されている数値は暫定です。
        </p>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--muted)]">
          今回の対話からは、この領域について上記の傾向が見えています。
        </p>
      )}

      {axis.notable_elements.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold tracking-wide text-[color:var(--muted)]">
            根拠が集まっている要素
          </h4>
          <ul className="mt-2 space-y-1.5">
            {axis.notable_elements.map((e) => (
              <li key={e.element_id} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 truncate">{e.name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-2)]">
                  <span
                    className="block h-full rounded-full bg-[color:var(--accent)]"
                    style={{ width: `${e.score}%`, opacity: 0.25 + 0.75 * e.confidence }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right tabular-nums text-[color:var(--muted)]">
                  {e.score.toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {axis.top_evidence.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-semibold tracking-wide text-[color:var(--muted)]">
            この結果に関連する主なEvidence
          </h4>
          <ul className="mt-2 space-y-2">
            {axis.top_evidence.map((e, i) => (
              <li
                key={i}
                className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-3 py-2 text-sm"
              >
                <span className="text-[color:var(--muted)]">「{e.quote}」</span>
                <span className="mt-1 block text-xs text-[color:var(--muted)]">
                  {e.element_name} / {e.context}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
