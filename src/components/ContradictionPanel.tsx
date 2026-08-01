"use client";

import type { Contradiction, Evidence } from "@/lib/types/diagnosis";

/**
 * §13 — contradictions are shown, not hidden. Both sides of every conflict are
 * kept in the database and displayed here; a contradiction means the model is
 * less certain, not that one of the statements was wrong.
 */

interface Props {
  contradictions: Contradiction[];
  evidence: Evidence[];
  elementNames: Record<string, string>;
}

export default function ContradictionPanel({ contradictions, evidence, elementNames }: Props) {
  if (contradictions.length === 0) return null;

  const byId = new Map(evidence.map((e) => [e.evidence_id, e]));
  const unresolved = contradictions.filter((c) => c.status === "unresolved");

  return (
    <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
      <h2 className="text-lg font-semibold">両立しにくい発言</h2>
      <p className="mt-1 text-xs text-[color:var(--muted)]">
        どちらかが誤りというわけではありません。人は文脈によって違う面を見せます。
        未解決の矛盾がある要素は、確からしさを下げて扱っています（未解決 {unresolved.length} 件）。
      </p>

      <ul className="mt-4 space-y-3">
        {contradictions.map((c) => {
          const a = byId.get(c.evidence_a);
          const b = byId.get(c.evidence_b);
          return (
            <li
              key={c.contradiction_id}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--surface-2)] p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs text-[color:var(--muted)]">
                <span>{c.elements.map((id) => elementNames[id] ?? id).join(" / ")}</span>
                <span className="tabular-nums">severity {c.severity.toFixed(2)}</span>
                <span
                  className={
                    c.status === "resolved"
                      ? "rounded bg-sky-950/60 px-1.5 py-0.5 text-sky-200"
                      : "rounded bg-amber-950/60 px-1.5 py-0.5 text-amber-200"
                  }
                >
                  {c.status === "resolved" ? "解消済み" : "未解決"}
                </span>
              </div>
              {a && <p className="mt-2">A:「{a.quote}」</p>}
              {b && <p className="mt-1">B:「{b.quote}」</p>}
              {c.resolution_note && (
                <p className="mt-2 text-xs text-[color:var(--muted)]">{c.resolution_note}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
