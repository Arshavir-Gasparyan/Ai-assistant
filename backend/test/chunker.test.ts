import { describe, expect, it } from 'vitest';
import {
  chunkSections,
  estimateTokens,
  normalizeText,
  pdfPagesToSections,
  splitMarkdownSections,
  splitText,
} from '../src/ingestion/chunker.js';

const sentence = (n: number) => `This is sentence number ${n} about the vacation policy.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ');

describe('normalizeText', () => {
  it('normalizes line endings, trailing spaces, blank lines and NUL bytes', () => {
    expect(normalizeText('a  \r\nb\u0000\n\n\n\nc\n')).toBe('a\nb\n\nc');
  });
});

describe('splitText', () => {
  it('keeps short text as a single chunk', () => {
    expect(splitText('Short text.', { chunkSize: 100, overlap: 10 })).toEqual(['Short text.']);
  });

  it('never produces a chunk longer than chunkSize', () => {
    const text = [paragraph(1, 8), paragraph(9, 8), paragraph(17, 8)].join('\n\n');
    const chunks = splitText(text, { chunkSize: 300, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(300);
  });

  it('prefers paragraph boundaries over cutting inside a paragraph', () => {
    const p1 = paragraph(1, 3); // ~170 chars
    const p2 = paragraph(4, 3);
    const chunks = splitText(`${p1}\n\n${p2}`, { chunkSize: 200, overlap: 0 });
    expect(chunks).toEqual([p1, p2]);
  });

  it('falls back to sentence boundaries when a paragraph is too long', () => {
    const chunks = splitText(paragraph(1, 10), { chunkSize: 150, overlap: 0 });
    // Every chunk ends at the end of a sentence, not mid-word.
    for (const c of chunks) expect(c).toMatch(/policy\.$/);
  });

  it('repeats the end of one chunk at the start of the next (overlap)', () => {
    const chunks = splitText(paragraph(1, 10), { chunkSize: 200, overlap: 60 });
    for (let i = 1; i < chunks.length; i++) {
      const lastSentenceOfPrevious = chunks[i - 1]!.split('. ').at(-1)!;
      expect(chunks[i]).toContain(lastSentenceOfPrevious);
    }
  });

  it('hard-splits a single "word" longer than chunkSize', () => {
    const chunks = splitText('x'.repeat(250), { chunkSize: 100, overlap: 0 });
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
  });

  it('rejects overlap >= chunkSize', () => {
    expect(() => splitText('abc', { chunkSize: 10, overlap: 10 })).toThrow();
  });
});

describe('splitMarkdownSections', () => {
  const md = [
    '# Leave',
    'Intro to leave.',
    '## Vacation',
    'Employees get 25 days.',
    '### Carry-over',
    'Up to 5 days carry over.',
    '## Sick leave',
    'Unlimited with a doctor note.',
    '```bash',
    '# this is a comment, not a heading',
    '```',
  ].join('\n');

  it('tracks the heading path for each section', () => {
    expect(splitMarkdownSections(md).map((s) => s.heading)).toEqual([
      'Leave',
      'Leave > Vacation',
      'Leave > Vacation > Carry-over',
      'Leave > Sick leave',
    ]);
  });

  it('does not treat # inside code fences as headings', () => {
    const last = splitMarkdownSections(md).at(-1)!;
    expect(last.heading).toBe('Leave > Sick leave');
    expect(last.text).toContain('# this is a comment');
  });

  it('keeps text before the first heading, without a heading', () => {
    expect(splitMarkdownSections('Preamble.\n# Title\nBody')[0]).toEqual({ text: 'Preamble.' });
  });
});

describe('chunkSections', () => {
  it('assigns sequential indices and carries page numbers and headings', () => {
    const chunks = chunkSections([
      ...pdfPagesToSections(['Page one text.', '', 'Page three text.']),
      { text: 'Markdown body.', heading: 'A > B' },
    ]);
    expect(chunks.map((c) => [c.chunkIndex, c.pageNumber, c.heading])).toEqual([
      [0, 1, null],
      [1, 3, null], // the empty page 2 produced no chunk, but page numbers stay accurate
      [2, null, 'A > B'],
    ]);
  });

  it('never lets a chunk span two sections', () => {
    const chunks = chunkSections(
      [
        { text: 'Alpha section.', heading: 'Alpha' },
        { text: 'Beta section.', heading: 'Beta' },
      ],
      { chunkSize: 1000, overlap: 100 },
    );
    expect(chunks.map((c) => c.content)).toEqual(['Alpha section.', 'Beta section.']);
  });

  it('estimates tokens at ~4 characters per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100);
  });
});
