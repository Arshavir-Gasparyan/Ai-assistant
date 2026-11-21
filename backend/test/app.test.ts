import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp, type App } from '../src/app.js';
import { fakeDeps, testEnv } from './helpers.js';

describe('app', () => {
  let app: App;

  beforeAll(async () => {
    app = buildApp(testEnv(), fakeDeps());

    // A throwaway route that exists only in this test, to exercise validation and
    // error handling before we have real endpoints like POST /search.
    app.post(
      '/__test/echo',
      { schema: { body: z.object({ query: z.string().min(1).max(10) }) } },
      async (request) => ({ query: request.body.query }),
    );
    app.get('/__test/boom', async () => {
      throw new Error('secret internal detail');
    });

    await app.ready();
  });

  afterAll(() => app.close());

  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('accepts a valid body', async () => {
    const res = await app.inject({ method: 'POST', url: '/__test/echo', payload: { query: 'hello' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ query: 'hello' });
  });

  it('rejects an invalid body with a 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/__test/echo', payload: { query: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(res.json().error.details[0].path).toContain('query');
  });

  it('hides internal error messages behind a generic 500', async () => {
    const res = await app.inject({ method: 'GET', url: '/__test/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(res.body).not.toContain('secret');
  });

  it('returns a structured 404 for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });
});
