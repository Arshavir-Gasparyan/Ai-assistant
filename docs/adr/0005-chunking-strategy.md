# ADR-0005: Chunking strategy, structure-aware recursive splitting

- **Status:** Accepted (parameters to be tuned with evaluation in Milestone 15)
- **Date:** 2026-11-21

## Context
Documents must be split into chunks that are embedded (M6), retrieved (M7) and cited (M8).
Chunk boundaries directly affect answer quality:
- **Too large:** one embedding averages several topics, so it matches many questions weakly.
  Fewer chunks fit in the prompt, and citations are vague ("somewhere in these 3 pages").
- **Too small:** chunks lose context ("It is 25 days." — what is?), and the answer's facts
  get scattered across many chunks.
- **Badly placed boundaries:** a sentence cut in half may be found by neither half.

We also need precise citation metadata: page number for PDFs, section for Markdown.

## Options considered
1. **Fixed-size windows** (every N characters/tokens). Simple, but cuts mid-sentence and
   ignores structure.
2. **Recursive character splitting**: try paragraph, then line, then sentence, then word
   boundaries, and pack pieces up to a size limit with overlap. Respects natural boundaries cheaply.
   (This is what LangChain's `RecursiveCharacterTextSplitter` does.)
3. **Structure-aware splitting**: use document structure (Markdown headings, PDF pages) as
   hard boundaries. Gives each chunk exact citation metadata.
4. **Semantic chunking**: embed every sentence and split where the meaning shifts. Better
   topical coherence, but it costs embedding calls at ingestion and is harder to reason about
   and test.
5. **Token-based sizes** (with a real tokenizer) instead of characters.

## Decision
Options **3 + 2**: split by structure first, then recursively by size.
- Markdown: a section per heading, and each chunk stores its **heading path**
  (`Handbook > Leave > Vacation > Carry-over`). Headings inside code fences are ignored.
- PDF: a section per page, and each chunk stores its **page number**.
- Inside a section: separators `\n\n` → `\n` → `". "` → `" "` → characters.
  `chunkSize = 1000` characters (~250 tokens), `overlap = 150` characters.
- A chunk never crosses a section boundary.
- Size is measured in characters, with a ~4 chars/token estimate. Exact token counting
  arrives with token budgets (M10). The embedding model's limit (8,191 tokens) is far above our chunk size.

## Why these numbers
~250-token chunks hold one or two paragraphs: big enough to keep context, small enough that
5–8 of them fit comfortably in a prompt, with citations pointing to a specific passage.
Overlap only matters when a section has to be cut *inside* a paragraph. Paragraph-boundary
cuts don't lose sentences.

## Consequences
- Short Markdown sections become small chunks (one section = one chunk). This is fine for
  citations. If retrieval suffers, consider merging tiny sibling sections.
- The heading path is stored separately from `content`. M6 will embed `heading + content`
  ("contextual chunk headers"), so a chunk like "Up to 5 days…" carries its topic.
- **PDF limitations:** PDFs have no paragraph markup. Extracted text has hard line breaks
  mid-sentence, and there's no structure beyond pages. A paragraph that spans a page break is
  split in two. Multi-column layouts, tables, headers/footers and scanned pages (OCR) are not
  handled. Revisit with a layout-aware parser if real documents need it.
- Parameters are constants in `chunker.ts`. Milestone 15 evaluation compares settings
  (e.g. 500/1000/1500 chars) using retrieval hit rate.
