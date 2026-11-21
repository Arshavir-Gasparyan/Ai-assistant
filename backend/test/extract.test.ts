import { describe, expect, it } from 'vitest';
import { detectFileKind, extractDocument } from '../src/ingestion/extract.js';
import { sanitizeFilename } from '../src/ingestion/ingest.js';
import { makePdf } from './fixtures/make-pdf.js';

describe('detectFileKind', () => {
  const pdf = makePdf([['Hello']]);

  it('accepts a real PDF', () => {
    expect(detectFileKind('report.PDF', pdf)).toBe('pdf');
  });

  it('rejects a .pdf whose bytes are not a PDF', () => {
    expect(detectFileKind('fake.pdf', Buffer.from('just text'))).toBeNull();
  });

  it('accepts UTF-8 Markdown, including non-English text', () => {
    expect(detectFileKind('notes.md', Buffer.from('# Ողջույն\nПривет'))).toBe('markdown');
  });

  it('rejects binary data renamed to .md', () => {
    expect(detectFileKind('evil.md', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]))).toBeNull();
  });

  it('rejects other extensions even if the content is a PDF', () => {
    expect(detectFileKind('report.exe', pdf)).toBeNull();
    expect(detectFileKind('noextension', pdf)).toBeNull();
  });
});

describe('extractDocument', () => {
  it('extracts PDF text page by page with page numbers', async () => {
    const pdf = makePdf([['First page line.'], ['Second page line.']]);
    const { sections, pageCount } = await extractDocument('pdf', pdf);
    expect(pageCount).toBe(2);
    expect(sections).toEqual([
      { text: 'First page line.', pageNumber: 1 },
      { text: 'Second page line.', pageNumber: 2 },
    ]);
  });

  it('rejects a PDF with no text (like a scanned document)', async () => {
    await expect(extractDocument('pdf', makePdf([[]]))).rejects.toMatchObject({
      statusCode: 422,
      code: 'NO_EXTRACTABLE_TEXT',
    });
  });

  it('rejects a corrupt PDF without leaking parser details', async () => {
    const corrupt = Buffer.from('%PDF-1.4 this is not really a pdf');
    await expect(extractDocument('pdf', corrupt)).rejects.toMatchObject({ code: 'PDF_UNREADABLE' });
  });

  it('splits Markdown into heading sections', async () => {
    const { sections, pageCount } = await extractDocument('markdown', Buffer.from('# A\none\n## B\ntwo'));
    expect(pageCount).toBeNull();
    expect(sections).toEqual([
      { text: 'one', heading: 'A' },
      { text: 'two', heading: 'A > B' },
    ]);
  });
});

describe('sanitizeFilename', () => {
  it('strips directory components (path traversal)', () => {
    expect(sanitizeFilename('../../etc/passwd.md')).toBe('passwd.md');
    expect(sanitizeFilename('C:\\Users\\me\\doc.pdf')).toBe('doc.pdf');
  });

  it('removes control characters and rejects empty names', () => {
    expect(sanitizeFilename('bad\u0000\nname.md')).toBe('badname.md');
    expect(() => sanitizeFilename('../')).toThrow();
  });
});
