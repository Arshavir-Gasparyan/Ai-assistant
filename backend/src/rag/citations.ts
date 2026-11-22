/**
 * Never trust the model's citations blindly. It can cite [7] when there were 5 sources,
 * or list a source in `citations` that it never referenced in the text.
 *
 * The answer TEXT is what the user reads, so its [n] markers are the source of truth:
 *   - markers that point to a real source are kept, in order of first appearance;
 *   - markers that point nowhere are removed from the text.
 */
export function resolveCitations(answer: string, sourceCount: number): { text: string; cited: number[] } {
  const cited: number[] = [];
  const text = answer
    .replace(/\[(\d+)\]/g, (marker, digits: string) => {
      const n = Number(digits);
      if (n < 1 || n > sourceCount) return ''; // hallucinated source number
      if (!cited.includes(n)) cited.push(n);
      return marker;
    })
    .replace(/ +([.,;:!?])/g, '$1') // tidy "text [9]." → "text ." → "text."
    .replace(/ {2,}/g, ' ')
    .trim();
  return { text, cited };
}
