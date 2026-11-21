/**
 * CHUNKING: split a document into pieces ("chunks") that are retrieved and cited individually.
 *
 * Why not store whole documents? Retrieval compares the QUESTION with each stored piece.
 * - A whole 40-page handbook has one embedding that averages everything it covers, so it
 *   matches every question a little and none precisely. It also wouldn't fit in the prompt.
 * - A single sentence is too small: "It is 25 days." has lost what "it" means.
 * A chunk should be a self-contained passage of a few paragraphs about ONE topic.
 *
 * Strategy (see ADR-0005), in two stages:
 *   1. STRUCTURE: split by document structure first. Markdown by headings, PDFs by page.
 *      Chunks never cross a section, so each one has one heading path / one page to cite.
 *   2. SIZE: inside a section, recursive splitting. Try the most natural boundary first
 *      (paragraph), and only fall back to smaller ones (line → sentence → word → character)
 *      for pieces that are still too long. Then pack pieces back together up to `chunkSize`,
 *      with `overlap` characters repeated between neighbours so a sentence that falls on
 *      a boundary still appears whole in at least one chunk.
 *
 * This is handwritten on purpose. In Milestone 11 we compare it with LangChain's
 * RecursiveCharacterTextSplitter, which uses the same idea.
 */

export interface Section {
  text: string;
  pageNumber?: number;
  heading?: string;
}

export interface Chunk {
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  heading: string | null;
  tokenEstimate: number;
}

export interface ChunkOptions {
  /** Max characters per chunk. ~1000 chars ≈ 250 tokens of English. */
  chunkSize: number;
  /** Characters repeated from the end of the previous chunk. */
  overlap: number;
}

export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { chunkSize: 1000, overlap: 150 };

/** Boundaries to try, from most natural to least. '' = split between characters. */
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

/** Rough rule of thumb for English: 1 token ≈ 4 characters. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// ---------------------------------------------------------------------------
// Stage 1: structure
// ---------------------------------------------------------------------------

/** Clean up extraction noise without changing meaning. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n') // Windows/Mac line endings → \n
    .replace(/\u0000/g, '') // NUL bytes (Postgres text can't store them)
    .replace(/[ \t]+\n/g, '\n') // trailing spaces
    .replace(/\n{3,}/g, '\n\n') // at most one blank line
    .trim();
}

/**
 * Split Markdown into sections at headings and remember the heading PATH:
 *   # Leave            → "Leave"
 *   ## Vacation        → "Leave > Vacation"
 *   ### Carry-over     → "Leave > Vacation > Carry-over"
 * The path tells retrieval and the LLM WHERE a chunk sits: "up to 5 days" means little
 * on its own, but under "Leave > Vacation > Carry-over" it's clearly about vacation.
 */
export function splitMarkdownSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const headingStack: string[] = [];
  let lines: string[] = [];
  let inCodeFence = false;

  const flush = () => {
    const text = normalizeText(lines.join('\n'));
    if (text) {
      const heading = headingStack.filter(Boolean).join(' > ');
      sections.push(heading ? { text, heading } : { text });
    }
    lines = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    // A '#' inside a ``` code block is a comment or shell prompt, not a heading.
    if (/^\s*(```|~~~)/.test(line)) inCodeFence = !inCodeFence;

    const match = inCodeFence ? null : /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) {
      flush();
      const level = match[1]!.length;
      headingStack.length = level - 1; // drop deeper/equal levels
      headingStack[level - 1] = match[2]!;
      continue;
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/** Each PDF page becomes a section, so every chunk can cite one page number. */
export function pdfPagesToSections(pages: string[]): Section[] {
  return pages
    .map((text, i) => ({ text: normalizeText(text), pageNumber: i + 1 }))
    .filter((s) => s.text.length > 0);
}

// ---------------------------------------------------------------------------
// Stage 2: size
// ---------------------------------------------------------------------------

/** Split on `sep` but keep the separator attached to the end of each piece. */
function splitKeepingSeparator(text: string, sep: string): string[] {
  if (sep === '') return [...text];
  const parts = text.split(sep);
  return parts.map((p, i) => (i < parts.length - 1 ? p + sep : p)).filter((p) => p.length > 0);
}

/** Break text into pieces that are each ≤ chunkSize, using the most natural separator possible. */
function splitRecursively(text: string, chunkSize: number, separators: string[]): string[] {
  if (text.length <= chunkSize) return [text];

  const [sep, ...finer] = separators;
  if (sep === undefined) return [text]; // unreachable: '' always succeeds

  const pieces: string[] = [];
  for (const part of splitKeepingSeparator(text, sep)) {
    if (part.length <= chunkSize) pieces.push(part);
    else pieces.push(...splitRecursively(part, chunkSize, finer));
  }
  return pieces;
}

/** Greedily pack small pieces into chunks ≤ chunkSize, carrying `overlap` chars forward. */
function mergePieces(pieces: string[], { chunkSize, overlap }: ChunkOptions): string[] {
  const chunks: string[] = [];
  let window: string[] = [];
  let windowLength = 0;

  for (const piece of pieces) {
    if (windowLength + piece.length > chunkSize && window.length > 0) {
      chunks.push(window.join(''));
      // Keep only the tail of the window as overlap, and make room for the new piece.
      while (
        window.length > 0 &&
        (windowLength > overlap || windowLength + piece.length > chunkSize)
      ) {
        windowLength -= window.shift()!.length;
      }
    }
    window.push(piece);
    windowLength += piece.length;
  }
  if (window.length > 0) chunks.push(window.join(''));

  return chunks.map((c) => c.trim()).filter((c) => c.length > 0);
}

export function splitText(text: string, options: ChunkOptions = DEFAULT_CHUNK_OPTIONS): string[] {
  if (options.overlap >= options.chunkSize) throw new Error('overlap must be smaller than chunkSize');
  return mergePieces(splitRecursively(text, options.chunkSize, SEPARATORS), options);
}

// ---------------------------------------------------------------------------
// Both stages together
// ---------------------------------------------------------------------------

export function chunkSections(
  sections: Section[],
  options: ChunkOptions = DEFAULT_CHUNK_OPTIONS,
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const section of sections) {
    for (const content of splitText(section.text, options)) {
      chunks.push({
        chunkIndex: chunks.length,
        content,
        pageNumber: section.pageNumber ?? null,
        heading: section.heading ?? null,
        tokenEstimate: estimateTokens(content),
      });
    }
  }
  return chunks;
}
