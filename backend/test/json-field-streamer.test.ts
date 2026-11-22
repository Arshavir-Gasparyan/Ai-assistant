import { describe, expect, it } from 'vitest';
import { createJsonStringFieldStreamer } from '../src/llm/json-field-streamer.js';

/** Feed `json` in the given pieces and return everything the streamer emitted. */
function feed(pieces: string[], field = 'answer') {
  const streamer = createJsonStringFieldStreamer(field);
  return pieces.map((p) => streamer.push(p));
}

const ANSWER = 'Up to 5 days "carry-over"\nper year: café ✓ \\ / [1][2]';
const JSON_TEXT = JSON.stringify({ answerable: true, answer: ANSWER, citations: [1, 2] });

describe('createJsonStringFieldStreamer', () => {
  it('decodes the field when the whole JSON arrives at once', () => {
    expect(feed([JSON_TEXT]).join('')).toBe(ANSWER);
  });

  it('gives the same result for EVERY possible split into two pieces', () => {
    for (let i = 0; i <= JSON_TEXT.length; i++) {
      expect(feed([JSON_TEXT.slice(0, i), JSON_TEXT.slice(i)]).join(''), `split at ${i}`).toBe(ANSWER);
    }
  });

  it('works one character at a time (escapes split across pieces)', () => {
    expect(feed([...JSON_TEXT]).join('')).toBe(ANSWER);
  });

  it('emits text incrementally, not only at the end', () => {
    const out = feed(['{"answerable":true,"answer":"Up to', ' 5 days', '","citations":[]}']);
    expect(out).toEqual(['Up to', ' 5 days', '']);
  });

  it('decodes \\u escapes, including ones split mid-sequence', () => {
    expect(feed(['{"answer":"caf\\u00', 'e9"}']).join('')).toBe('café');
  });

  it('emits nothing before the field and nothing after its closing quote', () => {
    const out = feed(['{"answerable":false,', '"answer":"', '"', ',"citations":[],"answer2":"x"}']);
    expect(out.join('')).toBe('');
  });

  it('ignores the field name appearing as part of a longer key', () => {
    expect(feed(['{"my_answer":"no","answer":"yes"}']).join('')).toBe('yes');
  });
});
