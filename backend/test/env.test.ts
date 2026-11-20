import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

describe('loadEnv', () => {
  it('applies defaults when variables are missing', () => {
    const env = loadEnv({});
    expect(env).toMatchObject({ NODE_ENV: 'development', API_PORT: 4000, LOG_LEVEL: 'info' });
  });

  it('coerces API_PORT from string to number', () => {
    expect(loadEnv({ API_PORT: '5001' }).API_PORT).toBe(5001);
  });

  it('fails fast with the variable name when a value is invalid', () => {
    expect(() => loadEnv({ API_PORT: 'not-a-port' })).toThrow(/API_PORT/);
    expect(() => loadEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
