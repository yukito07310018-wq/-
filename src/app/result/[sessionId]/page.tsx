import Link from "next/link";
import { notFound } from "next/navigation";
import SessionActions from "@/components/SessionActions";
import TopicReading from "@/components/TopicReading";
import { readSession } from "@/lib/interview/readingService";
import { ELEMENTS } from "@/lib/model/elements";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The result page, and the third way a reading gets run.
 *
 * Most sessions end by the person closing the tab, so opening this page is what
 * triggers the reading for them — there is no other moment left. A session read
 * once returns its stored reading and never calls the model again.
 *
 * Gone from this page: the ten-axis radar, every Score and Confidence figure,
 * the coverage percentage, the 「情報不足」 badges and the contradiction panel.
 * All of them displayed numbers that, in the only two live sessions, were their
 * own initial values.
 */
export default async function ResultPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const outcome = await readSession(sessionId);
  if (outcome.status === "not_found") notFound();

  const topicNames: Record<string, string> = {};
  for (const e of ELEMENTS) topicNames[e.element_id] = e.name;

  return (
    <main className="mx-auto max-w-3xl space-y-5 px-4 py-10">
      <header>
        <h1 className="text-2xl font-bold">あなたが使っていた言葉</h1>
        {outcome.status === "ready" && (
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            {outcome.reading.turn_count} 問の対話から、話題ごとにそのまま抜き出しました。
          </p>
        )}
      </header>

      {outcome.status === "ready" && (
        <TopicReading topics={outcome.reading.topics} topicNames={topicNames} />
      )}

      {outcome.status === "aborted" && (
        <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
          <p className="text-sm leading-relaxed">
            この対話は途中で中断されました。読み取りは行いません。
          </p>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            落ち着いてから、またいつでも新しく始めることができます。
          </p>
        </section>
      )}

      {outcome.status === "too_short" && (
        <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
          <p className="text-sm leading-relaxed">
            まだ対話が {outcome.turnCount} 問しかないため、読み取りは行っていません。
            少なくとも {outcome.required} 問は必要です。
          </p>
          <p className="mt-3 text-sm text-[color:var(--muted)]">
            対話の続きから再開すると、読み取りができるようになります。
          </p>
        </section>
      )}

      {(outcome.status === "truncated" || outcome.status === "failed") && (
        <section className="rounded-xl border border-red-900/60 bg-red-950/30 p-6">
          <h2 className="text-sm font-semibold text-red-200">読み取りが完了しませんでした</h2>
          <p className="mt-2 text-sm leading-relaxed text-red-100">{outcome.message}</p>
          <p className="mt-3 text-xs text-[color:var(--muted)]">
            結果は保存されていないため、この画面を開き直すともう一度読み取りを試みます。
          </p>
        </section>
      )}

      <SessionActions sessionId={sessionId} />

      <div className="flex justify-between pb-10 text-sm">
        <Link href="/" className="text-[color:var(--muted)] underline underline-offset-4">
          トップへ
        </Link>
        <Link href="/interview" className="text-[color:var(--accent)] underline underline-offset-4">
          新しく始める
        </Link>
      </div>
    </main>
  );
}
