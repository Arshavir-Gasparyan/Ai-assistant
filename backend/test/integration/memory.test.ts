import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { ingestDocument } from '../../src/ingestion/ingest.js';
import { createRedisConversationStore, type ConversationStore } from '../../src/memory/store.js';
import { createRedis, type Redis } from '../../src/redis/client.js';
import { fakeDeps, testEnv } from '../helpers.js';
import { testDatabaseUrl } from './test-db.js';

/**
 * Real Redis, logical database 15 (the app uses 0), so FLUSHDB here can't touch app data.
 * Needs: docker compose up -d redis
 */
const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';

const HANDBOOK = `# Handbook
## Vacation
Full-time employees receive 25 days of paid vacation per year.
### Carry-over
Up to 5 unused vacation days can be carried over into the next year.
## Remote work
Employees may work remotely up to 3 days per week.`;

describe('conversation memory (real Redis)', () => {
  let redis: Redis;
  let store: ConversationStore;
  const deps = fakeDeps();

  beforeAll(async () => {
    redis = createRedis(TEST_REDIS_URL, deps.log);
    try {
      await redis.connect();
    } catch {
      throw new Error('Cannot reach Redis for integration tests. Is it running? (docker compose up -d redis)');
    }
    store = createRedisConversationStore(redis, 60);
  });

  beforeEach(async () => {
    await redis.flushDb();
  });

  afterAll(async () => {
    await redis.close();
  });

  describe('Redis store', () => {
    it('appends messages, counts tokens and loads them back in order', async () => {
      expect(await store.append('c1', [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }], 120)).toBe(2);
      expect(await store.append('c1', [{ role: 'user', content: 'q2' }], 30)).toBe(3);

      expect(await store.load('c1')).toEqual({
        summary: null,
        messages: [
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'q2' },
        ],
        tokensUsed: 150,
      });
    });

    it('an unknown conversation loads as empty', async () => {
      expect(await store.load('nope')).toEqual({ summary: null, messages: [], tokensUsed: 0 });
    });

    it('sets a TTL on every key (conversations expire after inactivity)', async () => {
      await store.append('c1', [{ role: 'user', content: 'q1' }], 10);
      await store.compact('c1', 'summary', 0);
      for (const key of ['conv:c1:messages', 'conv:c1:tokens', 'conv:c1:summary']) {
        const ttl = await redis.ttl(key);
        expect(ttl, key).toBeGreaterThan(0);
        expect(ttl, key).toBeLessThanOrEqual(60);
      }
    });

    it('compact drops exactly the summarized messages, even if new ones arrived meanwhile', async () => {
      await store.append('c1', [1, 2, 3, 4].map((i) => ({ role: 'user' as const, content: `m${i}` })), 0);
      // Summarizer covered m1, m2. Meanwhile m5 was appended.
      await store.append('c1', [{ role: 'user', content: 'm5' }], 0);
      await store.compact('c1', 'about m1 and m2', 2);

      const state = await store.load('c1');
      expect(state.summary).toBe('about m1 and m2');
      expect(state.messages.map((m) => m.content)).toEqual(['m3', 'm4', 'm5']);
    });

    it('append with no messages only adds tokens', async () => {
      await store.append('c1', [{ role: 'user', content: 'q1' }], 10);
      expect(await store.append('c1', [], 5)).toBe(1);
      expect((await store.load('c1')).tokensUsed).toBe(15);
    });

    it('clear forgets the conversation', async () => {
      await store.append('c1', [{ role: 'user', content: 'q1' }], 10);
      await store.clear('c1');
      expect(await store.load('c1')).toEqual({ summary: null, messages: [], tokensUsed: 0 });
    });
  });

  describe('POST /chat with memory (real Redis + PostgreSQL)', () => {
    let app: App;
    let db: pg.Pool;

    beforeAll(async () => {
      db = new pg.Pool({ connectionString: testDatabaseUrl().testUrl });
      await db.query('TRUNCATE documents CASCADE');
      await ingestDocument(db, deps.embedder, deps.log, { filename: 'handbook.md', data: Buffer.from(HANDBOOK) });
      app = buildApp(testEnv(), { ...deps, db, redis, conversationStore: undefined }); // → Redis store
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
      await db.end();
    });

    const ask = (payload: object) => app.inject({ method: 'POST', url: '/chat', payload }).then((r) => r.json());

    it('a follow-up question uses the conversation to find the right answer', async () => {
      const first = await ask({ question: 'How many vacation days per year?' });
      expect(first.citations[0].heading).toBe('Handbook > Vacation');

      const followUp = await ask({ question: 'and how many can be carried over?', conversationId: first.conversationId });
      expect(followUp.conversationId).toBe(first.conversationId);
      expect(followUp.standaloneQuestion).toContain('vacation days');
      expect(followUp.citations[0].heading).toBe('Handbook > Vacation > Carry-over');

      const stored = await redis.lRange(`conv:${first.conversationId}:messages`, 0, -1);
      expect(stored).toHaveLength(4);
    });

    it('DELETE /conversations/:id forgets the conversation', async () => {
      const first = await ask({ question: 'How many vacation days per year?' });
      const res = await app.inject({ method: 'DELETE', url: `/conversations/${first.conversationId}` });
      expect(res.statusCode).toBe(204);
      expect(await redis.exists(`conv:${first.conversationId}:messages`)).toBe(0);
    });

    it('rejects a conversationId that is not a UUID', async () => {
      const res = await app.inject({ method: 'POST', url: '/chat', payload: { question: 'q', conversationId: 'conv:*' } });
      expect(res.statusCode).toBe(400);
    });
  });
});
