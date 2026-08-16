/**
 * The output of the app, and the only thing the result page shows.
 *
 * Two things, no numbers: the topics a person talked about, and the words they
 * used while talking about them. The quote is the content; the topic is only a
 * coordinate for it.
 */

export interface ReadingQuote {
  /** The user's own words, exactly as they typed them. Never rewritten. */
  text: string;
  turn: number;
}

/**
 * A run of consecutive turns on one subject, as the reading divided the
 * conversation up. Consecutive segments are, by construction, a topic change —
 * which is the only thing that makes "came back to it" observable.
 */
export interface ReadingSegment {
  from_turn: number;
  to_turn: number;
  /**
   * One of the hundred elements, or null when none of them fits.
   *
   * Chosen from the fixed list rather than written freely: a model inventing
   * its own name for a topic restates the person's subject in the model's
   * vocabulary, which is the one thing this app must not do. Elements are not
   * scored here — they are only the vocabulary for saying roughly where the
   * conversation sat.
   */
  element_id: string | null;
  quotes: ReadingQuote[];
}

export interface ReadingTopic {
  element_id: string | null;
  /**
   * How many separate times the person was on this subject.
   *
   * Only a departure and a return increments it. Staying on one subject for
   * four turns counts once however long it runs, because those turns are the
   * interview holding them there — counting them would measure how hard the AI
   * pressed, not what the person kept returning to.
   */
  returns: number;
  first_turn: number;
  quotes: ReadingQuote[];
}

export interface Reading {
  session_id: string;
  turn_count: number;
  /** In the order the person raised them. */
  topics: ReadingTopic[];
}
