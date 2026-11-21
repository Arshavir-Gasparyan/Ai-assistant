/**
 * Builds a minimal, valid, text-based PDF: one page per entry in `pages`, each
 * an array of lines. No dependencies, so tests (and sample docs) can create real
 * PDFs that pdf.js parses exactly like files from Word or Google Docs.
 *
 * PDF structure in one breath: numbered objects (catalog → page tree → pages →
 * content streams with text-drawing operators), then an "xref" table holding the
 * byte offset of every object, then a trailer pointing at the catalog.
 */
export function makePdf(pages: string[][]): Buffer {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const objects: string[] = [];
  const fontId = 3 + pages.length * 2; // after catalog(1), pages(2), and page+content pairs
  const pageIds = pages.map((_, i) => 3 + i * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  pages.forEach((lines, i) => {
    const pageId = pageIds[i]!;
    const contentId = pageId + 1;
    // BT/ET = begin/end text. Tf = font+size. TL = line spacing. Td = position. ' = next line + show text.
    const ops = ['BT', '/F1 11 Tf', '14 TL', '72 740 Td', ...lines.map((l) => `(${escape(l)}) '`), 'ET'].join('\n');
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
      `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(out, 'latin1');
}

/** Wrap a paragraph into lines of at most `width` characters (PDF text doesn't wrap itself). */
export function wrap(text: string, width = 90): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
