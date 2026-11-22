/**
 * An EMBEDDER turns text into a vector: a list of numbers that represents its meaning.
 *
 *   "How many vacation days do I get?"  →  [0.012, -0.044, 0.031, ... 1536 numbers]
 *
 * Texts with similar meaning get vectors pointing in similar directions, even with
 * no words in common ("vacation days" ≈ "paid time off"). That is what lets us find
 * relevant chunks for a question by measuring the angle between vectors.
 *
 * The rest of the app depends only on this interface, not on OpenAI. That makes the
 * provider swappable (OpenAI, a fake for tests, Ollama later) and keeps tests offline.
 */
export interface Embedder {
  /** Stored with each document, so vectors from different models are never mixed. */
  readonly model: string;
  readonly dimensions: number;
  /** One vector per input text, in the same order. */
  embed(texts: string[]): Promise<number[][]>;
}

/** Must match the column type in migrations/003_add_chunk_embeddings.sql: vector(1536). */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * The text we actually embed for a chunk: its heading path + its content.
 * "Up to 5 days can be carried over" alone barely mentions vacation; with the heading
 * "Handbook > Leave > Vacation > Carry-over" in front, its vector clearly does.
 * This technique is called a "contextual chunk header". The stored `content` stays unchanged.
 */
export function embeddingInput(chunk: { heading: string | null; content: string }): string {
  return chunk.heading ? `${chunk.heading}\n\n${chunk.content}` : chunk.content;
}

/** Cosine similarity: 1 = same direction, 0 = unrelated, -1 = opposite. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}

/** pgvector's text format is '[0.1,0.2,...]', which is exactly what JSON.stringify produces. */
export const toPgVector = (v: number[]) => JSON.stringify(v);
