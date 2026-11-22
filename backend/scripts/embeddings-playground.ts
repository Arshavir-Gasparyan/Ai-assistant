/**
 * See what an embedding is: sentences → vectors → similarity scores.
 *
 *   npm run embed:playground                       # uses OPENAI_API_KEY from ../.env
 *   EMBEDDING_PROVIDER=fake npm run embed:playground   # offline word-hashing, for contrast
 *
 * Cost with OpenAI: ~60 tokens ≈ $0.0000012.
 */
import { cosineSimilarity } from '../src/embeddings/embedder.js';
import { createEmbedder } from '../src/embeddings/index.js';
import { createLogger } from '../src/logger.js';

const env = {
  EMBEDDING_PROVIDER: (process.env.EMBEDDING_PROVIDER ?? 'openai') as 'openai' | 'fake',
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || undefined,
};
const embedder = createEmbedder(env, createLogger({ NODE_ENV: 'production', LOG_LEVEL: 'warn' }));

const sentences = [
  'How many vacation days do I get?', //                                  question
  'Full-time employees receive 25 days of paid vacation per year.', //   same topic, shared words
  'How much paid time off is there?', //                                  same meaning, different words
  'Passwords must be at least 14 characters long.', //                   unrelated
];

const vectors = await embedder.embed(sentences);

console.log(`Model: ${embedder.model}   Dimensions: ${vectors[0]!.length}\n`);
console.log(`"${sentences[0]}" becomes:`);
console.log(`  [${vectors[0]!.slice(0, 6).map((x) => x.toFixed(4)).join(', ')}, ... ${vectors[0]!.length - 6} more]\n`);

console.log('Cosine similarity to the question (1 = same direction, 0 = unrelated):');
sentences.slice(1).forEach((s, i) => {
  const score = cosineSimilarity(vectors[0]!, vectors[i + 1]!);
  const bar = '█'.repeat(Math.max(0, Math.round(score * 40)));
  console.log(`  ${score.toFixed(3)} ${bar}\n         "${s}"`);
});
