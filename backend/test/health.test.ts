import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { fakeDeps, testEnv } from './helpers.js';

async function get(url: string, deps = fakeDeps()) {
  const app = buildApp(testEnv(), deps);
  const res = await app.inject({ method: 'GET', url });
  await app.close();
  return res;
}

describe('GET /health (liveness)', () => {
  it('stays 200 even when dependencies are down', async () => {
    const res = await get('/health', fakeDeps({ dbDown: true, redisDown: true }));
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });
});

describe('GET /ready (readiness)', () => {
  it('is 200 when Postgres and Redis respond', async () => {
    const res = await get('/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ready', checks: { postgres: 'ok', redis: 'ok' } });
  });

  it('is 503 and names the failing dependency', async () => {
    const res = await get('/ready', fakeDeps({ redisDown: true }));
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'not_ready', checks: { postgres: 'ok', redis: 'error' } });
  });

  it('does not leak internal error details', async () => {
    const res = await get('/ready', fakeDeps({ dbDown: true }));
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('ECONNREFUSED');
  });
});
