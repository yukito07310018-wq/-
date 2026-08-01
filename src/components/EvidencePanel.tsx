"use client";

import { useMemo, useState } from "react";
import type { Evidence } from "@/lib/types/diagnosis";

/**
 * §32 — evidence transparency.
 * Shows quotes, types and the one-line rationale. Never shows prompts, raw LLM
 * output, or chain-of-thought.
 */

const TYPE_LABELS: Record<string, string> = {
  explicit_statement: "明示的な発言",
  personal_experience: "個人的な経験",
  behavioral_example: "行動の具体例",
  decision_example: "意思決定の例",
  value_statement: "価値観の表明",
  counterfactual_answer: "仮想状況への回答",
  reasoning_pattern: "思考の筋道",
  emotional_reaction: "感情的反応",
  self_description: "自己説明",
  contradiction: "矛盾",
  repeated_pattern: "反復パターン",
};

const DIRECTION_LABELS: Record<string, string> = {
  positive: "その特性を示す",
  negative: "その特性の弱さを示す",
  neutral: "参考情報",
};

interface Props {
  evidence: Evidence[];
  elementNames: Record<string, string>;
}

export default function EvidencePanel({ evidence, elementNames }: Props) {
  const [open, setOpen] = useState(false);

  const sorted = useMemo(
    () => [...evidence].sort((a, b) => a.turn_id - b.turn_id),
    [evidence]
  );

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span>
          <h2 className="text-lg font-semibold">なぜこの結果になったか</h2>
          <span className="text-xs text-[color:var(--muted)]">
            採用された根拠 {evidence.length} 件（あなたの発言からの引用）
          </span>
        </span>
        <span className="text-sm text-[color:var(--accent)]">{open ? "閉じる" : "開く"}</span>
      </button>

      {open && (
        <div className="mt-4 max-h-[520px] space-y-2 overflow-y-auto pr-1">
          {sorted.length === 0 && (
            <p className="text-sm text-[color:var(--muted)]">まだ根拠は採用されていません。</p>
          )}
          {sorted.map((e) => (
            <article
              key={e.evidence_id}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                <span className="rounded bg-black/30 px-1.5 py-0.5">{e.turn_id} 問目</span>
                <span>{elementNames[e.element_id] ?? e.element_id}</span>
                <span>/ {TYPE_LABELS[e.type] ?? e.type}</span>
                <span>/ {DIRECTION_LABELS[e.direction] ?? e.direction}</span>
                <span className="ml-auto tabular-nums">
                  強さ {e.strength.toFixed(2)} ・ 確からしさ {e.reliability.toFixed(2)}
                </span>
              </div>
              <p className="mt-2">「{e.quote}」</p>
              <p className="mt-1 text-xs text-[color:var(--muted)]">{e.context}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
