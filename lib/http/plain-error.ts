/** What a player sees when a request never got an answer, or the answer was not one the app wrote. */
export const COULD_NOT_REACH = 'That didn’t go through. Check your connection and try again.';

/**
 * A message that is safe to show a player. A network failure (a TypeError such as "Failed to fetch") or a
 * reply that is not JSON (a SyntaxError) becomes one plain sentence; an error the app wrote keeps its own text.
 */
export function plainError(caught: unknown, fallback: string): string {
  if (caught instanceof TypeError || caught instanceof SyntaxError) return COULD_NOT_REACH;
  return caught instanceof Error && caught.message ? caught.message : fallback;
}
