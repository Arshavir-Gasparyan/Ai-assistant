import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { RRF_K, reciprocalRankFusion } from '../src/search/rrf.js';
import { candidateCount } from '../src/search/search.js';
import { fakeDeps, testEnv } from './helpers.js';

describe('reciprocalRankFusion', () => {
  it('scores by position: 1 / (k + rank)', () => {
    const [first, second] = reciprocalRankFusion({ vector: ['a', 'b'] });
    expect(first).toEqual({ id: 'a', score: 1 / (RRF_K + 1), ranks: { vector: 1, keyword: null } });
    expect(second!.score).toBeCloseTo(1 / (RRF_K + 2));
  });

  it('rewards agreement: found by both lists beats #1 in only one', () => {
    const fused = reciprocalRankFusion({
      vector: ['only-vector', 'x', 'both'],
      keyword: ['only-keyword', 'y', 'z', 'w', 'both'],
    });
    expect(fused[0]!.id).toBe('both');
    expect(fused[0]!.ranks).toEqual({ vector: 3, keyword: 5 });
  });

  it('ignores raw scores entirely (lists are just ordered ids)', () => {
    const fused = reciprocalRankFusion({ vector: ['a', 'b'], keyword: ['b', 'a'] });
    // a: 1/61 + 1/62, b: 1/62 + 1/61 → equal score; the tie-break keeps it deterministic
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score);
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('works with a single list or empty lists', () => {
    expect(reciprocalRankFusion({ keyword: ['k1'] })[0]!.ranks).toEqual({ vector: null, keyword: 1 });
    expect(reciprocalRankFusion({ vector: [], keyword: [] })).toEqual([]);
    expect(reciprocalRankFusion({})).toEqual([]);
  });

  it('a larger k flattens the difference between top and lower ranks', () => {
    const gap = (k: number) => {
      const [a, b] = reciprocalRankFusion({ vector: ['a', 'b'] }, k);
      return a!.score / b!.score;
    };
    expect(gap(1)).toBeGreaterThan(gap(60));
  });
});

describe('candidateCount', () => {
  it('fetches more candidates than topK, within bounds', () => {
    expect(candidateCount(1)).toBe(20);
    expect(candidateCount(10)).toBe(40);
    expect(candidateCount(20)).toBe(50);
  });
});

describe('POST /search validation', () => {
  const app = buildApp(testEnv(), fakeDeps());
  const post = (body: unknown) => app.inject({ method: 'POST', url: '/search', payload: body as object });

  it.each([
    ['missing query', {}],
    ['empty query', { query: '' }],
    ['whitespace-only query', { query: '   ' }],
    ['query over 500 chars', { query: 'a'.repeat(501) }],
    ['topK too large', { query: 'vacation', topK: 21 }],
    ['topK not an integer', { query: 'vacation', topK: 2.5 }],
    ['unknown mode', { query: 'vacation', mode: 'magic' }],
  ])('400 for %s', async (_name, body) => {
    const res = await post(body);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
