import Link from "next/link";
import { notFound } from "next/navigation";
import AxisRadarChart from "@/components/AxisRadarChart";
import ContradictionPanel from "@/components/ContradictionPanel";
import DiagnosisSummary from "@/components/DiagnosisSummary";
import ElementInsight from "@/components/ElementInsight";
import EvidencePanel from "@/components/EvidencePanel";
import { rankAxes, type AxisRanking } from "@/lib/engine/ordinal";
import { buildProfile } from "@/lib/interview/profileService";
import { ELEMENTS } from "@/lib/model/elements";

export const dynamic = "force-dynamic";

/** §30/§31/§32 — result dashboard. Rendered server-side from the stored model. */
export default async function ResultPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const profile = await buildProfile(sessionId);
  if (!profile) notFound();

  const rankings = new Map<string, AxisRanking>(
    rankAxes(profile.axis_insights).map((r) => [r.axis_id, r])
  );

  const elementNames: Record<string, string> = {};
  for (const e of ELEMENTS) elementNames[e.element_id] = e.name;

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-10">
      <DiagnosisSummary
        sessionId={sessionId}
        axes={profile.axis_insights}
        diagnosisConfidence={profile.diagnosis_confidence}
        coverage={profile.coverage}
        turn={profile.turn}
        evidenceCount={profile.evidence.length}
      />

      <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-5">
        <h2 className="text-lg font-semibold">10軸の相対的な傾向</h2>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          あなたの10軸を互いに比べた順位です。他の人と比べた位置ではありません
          （比較のための基準集団を持っていないため）。
        </p>
        <AxisRadarChart axes={profile.axis_insights} />
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {profile.axis_insights.map((axis) => (
          <ElementInsight
            key={axis.axis_id}
            axis={axis}
            ranking={rankings.get(axis.axis_id)!}
          />
        ))}
      </div>

      <EvidencePanel evidence={profile.evidence} elementNames={elementNames} />

      <ContradictionPanel
        contradictions={profile.contradictions}
        evidence={profile.evidence}
        elementNames={elementNames}
      />

      <div className="flex justify-between pb-10 text-sm">
        <Link href="/" className="text-[color:var(--muted)] underline underline-offset-4">
          トップへ
        </Link>
        {profile.status === "active" && (
          <Link
            href="/interview"
            className="text-[color:var(--accent)] underline underline-offset-4"
          >
            新しい診断を始める
          </Link>
        )}
      </div>
    </main>
  );
}
