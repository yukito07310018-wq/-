"use client";

import ConfidenceBadge, { UNCERTAIN_THRESHOLD } from "./ConfidenceBadge";
import { BAND_LABEL, type AxisRanking } from "@/lib/engine/ordinal";
import type { AxisInsight } from "@/lib/interview/profileService";

/**
 * §31 — per-axis explanation.
 *
 * Reports the axis's rank among this person's ten, not a 0-100 score. The
 * ordering is what the model measures reliably (r = 0.98); the magnitude arrives
 * compressed ~3.1×, so a printed score invites comparisons of gaps the
 * instrument cannot support. See `lib/engine/ordinal.ts`.
 *
 * Wording is deliberately provisional ("傾向が見えています", never "あなたは○○な人です").
 */

interface Props {
  axis: AxisInsight;
  ranking: AxisRanking;
}

export default function ElementInsight({ axis, ranking }: Props) {
  const uncertain = axis.confidence < UNCERTAIN_THRESHOLD;
  const measuredElements = Math.round(axis.coverage * 10);

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className="text-lg font-semibold">{axis.name}</h3>
        <ConfidenceBadge confidence={axis.confidence} />
      </div>

      <p className="mt-1 text-xs text-[color:var(--muted)]">{axis.description}</p>

      <div className="mt-4 flex items-baseline gap-3">
        {ranking.rank === null ? (
          <span className="text-xl font-semibold text-[color:var(--muted)]">情報不足</span>
        ) : (
          <>
            <span className="text-3xl font-bold tabular-nums">{ranking.rank}</span>
            <span className="text-sm text-[color:var(--muted)]">位 / {ranking.outOf}軸中</span>
            <span className="rounded-full border border-[color:var(--border)] bg-[color:var(--surface-2)] px-2.5 py-0.5 text-xs text-[color:var(--muted)]">
              {BAND_LABEL[ranking.band]}
            </span>
          </>
        )}
        <span className="ml-auto text-xs text-[color:var(--muted)]">
          10要素中 {measuredElements} 要素に根拠あり
        </span>
      </div>

      {ranking.rank === null ? (
        <p className="mt-4 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          この軸については、まだ根拠が集まっていません。順位は出せません。
        </p>
      ) : uncertain ? (
        <p className="mt-4 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
          この軸については、まだ判断材料が足りません。順位は暫定です。
        </p>
      ) : (
        <p className="mt-4 text-sm text-[color:var(--muted)]">
          今回の対話からは、あなたの10軸の中でこの領域が{BAND_LABEL[ranking.band]}位置に出ています。
        </p>
      )}

      {axis.notable_elements.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold tracking-wide text-[color:var(--muted)]">
            根拠が集まっている要素
          </h4>
          {/*
            Element scores are not shown as numbers. Their test-retest reliability
            is 0.29 — the same person interviewed twice does not reproduce them —
            so what is reported is how much evidence was found, which is a fact
            about the conversation rather than an estimate of the person.
          */}
          <ul className="mt-2 space-y-1.5">
            {axis.notable_elements.map((e) => (
              <li key={e.element_id} className="flex items-center gap-3 text-sm">
                <span className="w-32 shrink-0 truncate">{e.name}</span>
                <span className="flex-1 text-xs text-[color:var(--muted)]">
                  {e.score >= 55 ? "現れている" : e.score <= 45 ? "あまり現れていない" : "どちらとも言えない"}
                </span>
                <span className="shrink-0 text-right text-xs tabular-nums text-[color:var(--muted)]">
                  根拠 {e.evidence_count} 件
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            要素単位の数値は再現性が不足しているため（同一人物の2回で r=0.29）、
            強弱の3段階と根拠の件数のみを表示しています。
          </p>
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
