import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const required = {
  DATABASE_URL: 'postgresql://u:p@localhost:5433/db',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadEnv', () => {
  it('applies defaults when optional variables are missing', () => {
    const env = loadEnv(required);
    expect(env).toMatchObject({ NODE_ENV: 'development', API_PORT: 4000, LOG_LEVEL: 'info' });
  });

  it('coerces API_PORT from string to number', () => {
    expect(loadEnv({ ...required, API_PORT: '5001' }).API_PORT).toBe(5001);
  });

  it('fails fast with the variable name when a value is invalid', () => {
    expect(() => loadEnv({ ...required, API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
    expect(() => loadEnv({ ...required, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('requires DATABASE_URL and REDIS_URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*REDIS_URL/);
  });

  it('rejects a URL with the wrong protocol', () => {
    expect(() => loadEnv({ ...required, DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('never includes secret values in the error message', () => {
    try {
      loadEnv({ ...required, REDIS_URL: 'ftp://user:SuperSecret@host' });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain('SuperSecret');
    }
  });
});

describe('loadEnv CORS_ORIGINS', () => {
  it('splits a comma-separated list and trims whitespace', () => {
    expect(
      loadEnv({ ...required, CORS_ORIGINS: 'http://a.test, http://b.test' }).CORS_ORIGINS,
    ).toEqual(['http://a.test', 'http://b.test']);
  });
});
