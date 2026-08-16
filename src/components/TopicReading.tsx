import type { ReadingTopic } from "@/lib/types/reading";

/**
 * The result, such as it is: what the person said, in the order they said it.
 *
 * The quotes are the content and the topic name is a coordinate for them, so
 * the quote is set large and the label small. Returning to a subject is marked
 * where it happened and nowhere else — in a ten-turn session, four turns to a
 * topic, there is room for two or three subjects and a return needs the third
 * block to land back on the first. Zero returns is the ordinary outcome, not a
 * failure, so nothing here is arranged around whether any were found.
 */

interface Props {
  topics: ReadingTopic[];
  /** Element display names, resolved server-side. */
  topicNames: Record<string, string>;
}

export default function TopicReading({ topics, topicNames }: Props) {
  if (topics.length === 0) {
    return (
      <section className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6">
        <p className="text-sm leading-relaxed text-[color:var(--muted)]">
          今回の対話からは、そのまま引用できる言葉を取り出せませんでした。
          もう少し長く話すと、拾えるものが出てきます。
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      {topics.map((topic, index) => (
        <section
          key={`${topic.element_id ?? "none"}-${topic.first_turn}-${index}`}
          className="rounded-xl border border-[color:var(--border)] bg-[color:var(--surface)] p-6"
        >
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 className="text-sm font-semibold tracking-wide text-[color:var(--muted)]">
              {topic.element_id ? topicNames[topic.element_id] ?? topic.element_id : "該当なし"}
            </h2>
            {topic.returns >= 2 && (
              <span className="rounded-full border border-[color:var(--accent)]/40 bg-[color:var(--accent)]/10 px-2.5 py-0.5 text-xs text-[color:var(--accent)]">
                一度離れてから、自分で{topic.returns}回戻ってきた話題
              </span>
            )}
          </div>

          <ul className="mt-4 space-y-4">
            {topic.quotes.map((quote, i) => (
              <li key={i} className="border-l-2 border-[color:var(--accent)]/50 pl-4">
                <p className="whitespace-pre-wrap text-lg leading-relaxed">「{quote.text}」</p>
                <p className="mt-1 text-xs text-[color:var(--muted)]">{quote.turn} 問目</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
