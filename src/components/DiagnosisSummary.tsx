"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ConfidenceBadge from "./ConfidenceBadge";
import type { AxisInsight } from "@/lib/interview/profileService";

/**
 * §31/§34.1 — the summary at the top of the result page.
 * Phrasing stays provisional and the medical disclaimer is always present.
 */

interface Props {
  sessionId: string;
  axes: AxisInsight[];
  diagnosisConfidence: number;
  coverage: number;
  turn: number;
  evidenceCount: number;
}

export default function DiagnosisSummary({
  sessionId,
  axes,
  diagnosisConfidence,
  coverage,
  turn,
  evidenceCount,
}: Props) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only axes with real support are worth naming as a tendency.
  const supported = axes.filter((a) => a.confidence >= 0.4);
  const strongest = [...supported].sort((a, b) => b.score - a.score).slice(0, 3);
  const weakest = axes.filter((a) => a.confidence < 0.4);

  async function onDelete() {
    if (!confirm("この診断のすべてのデータ（会話・引用・スコア）を削除します。元に戻せません。")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/session/${sessionId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error?.message ?? "削除に失敗しました。");
        return;
      }
      setDeleted(true);
      setTimeout(() => router.push("/"), 1500);
    } catch {
      setError("削除に失敗しました。通信環境を確認してください。");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">診断結果</h1>
        <ConfidenceBadge confidence={diagnosisConfidence} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-[color:var(--muted)]">対話ターン</dt>
          <dd className="text-xl font-semibold tabular-nums">{turn}</dd>
        </div>
        <div>
          <dt className="text-xs text-[color:var(--muted)]">採用された根拠</dt>
          <dd className="text-xl font-semibold tabular-nums">{evidenceCount}</dd>
        </div>
        <div>
          <dt className="text-xs text-[color:var(--muted)]">全体の確からしさ</dt>
          <dd className="text-xl font-semibold tabular-nums">{diagnosisConfidence.toFixed(2)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[color:var(--muted)]">カバー率</dt>
          <dd className="text-xl font-semibold tabular-nums">{(coverage * 100).toFixed(0)}%</dd>
        </div>
      </dl>

      {strongest.length > 0 ? (
        <p className="mt-5 text-sm leading-relaxed">
          今回の対話からは、
          <span className="font-semibold text-[color:var(--accent)]">
            {strongest.map((a) => a.name).join("・")}
          </span>
          の領域で特徴的な傾向が見えています。ただしこれは今回の会話の範囲での暫定的な像です。
        </p>
      ) : (
        <p className="mt-5 text-sm leading-relaxed text-[color:var(--muted)]">
          まだ根拠が十分に集まっていないため、傾向として提示できる領域はありません。
          対話を続けると、モデルの確からしさが上がります。
        </p>
      )}

      {weakest.length > 0 && (
        <p className="mt-3 text-sm text-[color:var(--muted)]">
          {weakest.map((a) => a.name).join("・")} については、まだ判断材料が足りません。
        </p>
      )}

      <p className="mt-5 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] px-4 py-3 text-xs leading-relaxed text-[color:var(--muted)]">
        この診断は、会話から得られた情報をもとにした暫定的な個人モデルです。
        人格を医学的・心理学的に診断するものではありません。
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-3 text-sm">
        {deleted ? (
          <span className="text-[color:var(--muted)]">削除しました。トップへ戻ります…</span>
        ) : (
          <>
            <button
              onClick={onDelete}
              disabled={deleting}
              className="rounded-lg border border-red-900/60 px-3 py-1.5 text-red-200 transition hover:bg-red-950/40 disabled:opacity-50"
            >
              {deleting ? "削除中…" : "このセッションのデータを削除"}
            </button>
            {error && <span className="text-red-300">{error}</span>}
          </>
        )}
      </div>
    </section>
  );
}
