import { EMBEDDING_DIMENSIONS, type Embedder } from './embedder.js';

/**
 * A deterministic, offline, free embedder for tests and for trying the app without an
 * API key (EMBEDDING_PROVIDER=fake).
 *
 * It uses the "hashing trick": each word is hashed to one of 1536 positions, and the
 * vector counts words per position (then gets normalized). Texts that SHARE WORDS end up
 * similar. Texts that mean the same thing with DIFFERENT words ("vacation" vs "time off")
 * do not. That is exactly the gap real embedding models close, so it's a useful contrast.
 */
export function createFakeEmbedder(model = 'fake-hashing-v1'): Embedder {
  return {
    model,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      return texts.map(hashEmbed);
    },
  };
}

const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'and', 'or', 'in', 'is', 'are', 'for', 'do', 'i', 'my', 'how', 'what', 'be', 'on', 'at', 'by', 'with']);

function hashEmbed(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    vector[fnv1a(word) % EMBEDDING_DIMENSIONS]! += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm ? vector.map((x) => x / norm) : vector;
}

/** FNV-1a: a tiny, fast, non-cryptographic string hash. */
function fnv1a(s: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
