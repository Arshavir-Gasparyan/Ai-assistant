import { isUtf8 } from 'node:buffer';
import { extname } from 'node:path';
import { extractText as extractPdfText } from 'unpdf';
import { AppError } from '../errors.js';
import { pdfPagesToSections, splitMarkdownSections, type Section } from './chunker.js';

export type FileKind = 'pdf' | 'markdown';

const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown']);

/**
 * Decide what a file really is. We DON'T trust the client's Content-Type header or the
 * extension alone; both are trivially faked. We also check the bytes:
 *  - PDF: every PDF starts with the "magic bytes" %PDF-
 *  - Markdown: must be valid UTF-8 text with no NUL bytes (i.e. not a renamed binary)
 */
export function detectFileKind(filename: string, data: Buffer): FileKind | null {
  const ext = extname(filename).toLowerCase();
  if (ext === '.pdf') {
    return data.subarray(0, 5).toString('latin1') === '%PDF-' ? 'pdf' : null;
  }
  if (MARKDOWN_EXTENSIONS.has(ext)) {
    return isUtf8(data) && !data.includes(0) ? 'markdown' : null;
  }
  return null;
}

export interface ExtractedDocument {
  sections: Section[];
  pageCount: number | null;
}

export async function extractDocument(kind: FileKind, data: Buffer): Promise<ExtractedDocument> {
  if (kind === 'markdown') {
    return { sections: splitMarkdownSections(data.toString('utf8')), pageCount: null };
  }

  let pages: string[];
  let totalPages: number;
  try {
    // Copy into a fresh Uint8Array: pdf.js may take ownership of (detach) the buffer it's given.
    ({ text: pages, totalPages } = await extractPdfText(new Uint8Array(data), { mergePages: false }));
  } catch {
    // Corrupt or password-protected file. Don't echo parser internals to the client.
    throw new AppError(422, 'PDF_UNREADABLE', 'The PDF could not be read (corrupt or encrypted?)');
  }

  const sections = pdfPagesToSections(pages);
  if (sections.length === 0) {
    // Scanned PDFs are images of text. Without OCR there is nothing to extract.
    throw new AppError(422, 'NO_EXTRACTABLE_TEXT', 'The PDF contains no extractable text (scanned images need OCR, which is not supported)');
  }
  return { sections, pageCount: totalPages };
}
