/**
 * The single definition of what the model is shown of the user's own words.
 *
 * Prompt construction and quote verification must agree character-for-character:
 * if the prompt shows the model a string the verifier never sees, a perfectly
 * verbatim quote is rejected as ungrounded. Both sides call this.
 */

/** Removes attempts to close (or re-open) the data delimiter from inside it. */
export function stripUserAnswerTags(text: string): string {
  return text.replace(/<\/?user_answer>/gi, "");
}
