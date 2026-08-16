import type { ReadingSegment, ReadingTopic } from "../types/reading";

/**
 * Counting how many separate times a person came back to a subject.
 *
 * The rule that matters is what is *not* counted. The interview deliberately
 * holds one topic for up to four turns, so repetition inside a block is the
 * interview's doing, not the person's. Counting it would turn this number into
 * a measure of how long the AI pressed. Only a departure followed by the person
 * raising the subject again counts, which is why the reading is asked for
 * segments — where the conversation changed subject — and not merely for a
 * topic label per turn.
 */

/**
 * Joins consecutive segments the reading gave the same element to.
 *
 * A model asked to divide a conversation will sometimes cut one continuous
 * stretch in two. Uncorrected, that reads as a departure and a return that
 * never happened.
 *
 * Nulls are never joined: null means "none of the hundred fits", and two
 * unnameable subjects in a row are two subjects, not one seen twice.
 */
export function mergeAdjacentSegments(
  segments: readonly ReadingSegment[]
): ReadingSegment[] {
  const ordered = [...segments].sort((a, b) => a.from_turn - b.from_turn);
  const merged: ReadingSegment[] = [];

  for (const segment of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && previous.element_id !== null && previous.element_id === segment.element_id) {
      merged[merged.length - 1] = {
        ...previous,
        to_turn: Math.max(previous.to_turn, segment.to_turn),
        quotes: [...previous.quotes, ...segment.quotes],
      };
      continue;
    }
    merged.push({ ...segment, quotes: [...segment.quotes] });
  }

  return merged;
}

/**
 * Turns verified segments into the topics the result page shows, in the order
 * the person first raised them.
 *
 * Segments left with no quotes — everything the model claimed was said there
 * turned out not to have been — are dropped, but only *after* merging, so an
 * unverifiable stretch between two visits to the same subject still separates
 * them into two.
 */
export function summarizeTopics(segments: readonly ReadingSegment[]): ReadingTopic[] {
  const withQuotes = mergeAdjacentSegments(segments).filter((s) => s.quotes.length > 0);

  const byElement = new Map<string, ReadingTopic>();
  const topics: ReadingTopic[] = [];

  for (const segment of withQuotes) {
    const quotes = [...segment.quotes].sort((a, b) => a.turn - b.turn);

    // An unnamed topic cannot be recognised as the same one twice, so it never
    // accumulates: each stands alone at one visit.
    if (segment.element_id === null) {
      topics.push({ element_id: null, returns: 1, first_turn: segment.from_turn, quotes });
      continue;
    }

    const existing = byElement.get(segment.element_id);
    if (existing) {
      existing.returns += 1;
      existing.quotes = [...existing.quotes, ...quotes];
      continue;
    }

    const topic: ReadingTopic = {
      element_id: segment.element_id,
      returns: 1,
      first_turn: segment.from_turn,
      quotes,
    };
    byElement.set(segment.element_id, topic);
    topics.push(topic);
  }

  return topics.sort((a, b) => a.first_turn - b.first_turn);
}
