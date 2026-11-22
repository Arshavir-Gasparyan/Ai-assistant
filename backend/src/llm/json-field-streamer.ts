/**
 * Extracts ONE string field from JSON while the JSON is still arriving.
 *
 * With structured outputs, the model streams JSON text in arbitrary pieces:
 *
 *   '{"answ'  'erable":true,"ans'  'wer":"Up to 5 da'  'ys\\n[1]","cit'  'ations":[1]}'
 *
 * We want to show the user "Up to 5 days\n[1]" as it grows, without waiting for the
 * closing brace (JSON.parse only works on complete JSON). push() returns the newly decoded
 * characters of the field each time, handling escapes that are split across pieces.
 *
 * Limits (fine for our schema): the field must be a top-level string, and the key must not
 * appear earlier inside another string value. Our schema puts `answerable` (a boolean) first.
 */
export function createJsonStringFieldStreamer(field: string) {
  const keyPattern = new RegExp(`"${field}"\\s*:\\s*"`);
  const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };

  let buffer = '';
  let state: 'seeking' | 'reading' | 'done' = 'seeking';
  let pos = 0; // next unread index in buffer while reading

  return {
    push(chunk: string): string {
      buffer += chunk;

      if (state === 'seeking') {
        const match = keyPattern.exec(buffer);
        if (!match) return '';
        state = 'reading';
        pos = match.index + match[0].length;
      }
      if (state === 'done') return '';

      let out = '';
      while (pos < buffer.length) {
        const ch = buffer[pos]!;
        if (ch === '"') {
          state = 'done'; // unescaped quote = end of the string value
          break;
        }
        if (ch !== '\\') {
          out += ch;
          pos += 1;
          continue;
        }
        // Escape sequence: may be incomplete at the end of this chunk. If so, wait for more.
        const next = buffer[pos + 1];
        if (next === undefined) break;
        if (next === 'u') {
          const hex = buffer.slice(pos + 2, pos + 6);
          if (hex.length < 4) break;
          out += String.fromCharCode(parseInt(hex, 16));
          pos += 6;
        } else {
          out += ESCAPES[next] ?? next;
          pos += 2;
        }
      }
      return out;
    },
  };
}
