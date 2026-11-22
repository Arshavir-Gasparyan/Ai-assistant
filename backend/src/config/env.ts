import { z } from 'zod';

/**
 * Every environment variable the backend reads, validated once at startup.
 *
 * Why: process.env values are all `string | undefined`. Without validation, a typo in
 * .env only shows up later as a confusing runtime error (e.g. "connect ECONNREFUSED"
 * minutes after boot). With this schema the app refuses to start and says exactly
 * which variable is wrong.
 *
 * New variables are added here as milestones need them (DATABASE_URL in M4, keys in M6...).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  // z.coerce turns the string "4000" into the number 4000.
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Browser origins allowed to call the API (comma-separated). The Next.js dev server by default.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  // Maximum upload size. Larger files are rejected with 413 before they're fully read.
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024), // 10 MB
  // Embeddings (Milestone 6). 'fake' = offline word-hashing vectors for tests/demos without a key.
  EMBEDDING_PROVIDER: z.enum(['openai', 'fake']).default('openai'),
  // Optional at boot: without it the API still runs, but ingestion and chat return 503.
  // An empty value ("OPENAI_API_KEY=" in .env) counts as not set.
  // Chat model (Milestone 8). 'fake' = extracts a sentence from the best source, no LLM.
  CHAT_PROVIDER: z.enum(['openai', 'fake']).default('openai'),
  // Any OpenAI chat model name. Pricing for cost logs lives in src/llm/usage.ts.
  CHAT_MODEL: z.string().min(1).default('gpt-4.1-mini'),
  OPENAI_API_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(20).optional()),
  // Required, no defaults: the app can't do anything useful without them, so fail at boot.
  // Locally: localhost:5433 (see .env.example). In Docker: the service name, e.g. postgres:5432.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
});

export type Env = z.infer<typeof envSchema>;

/** Pure function so tests can pass a fake env instead of mutating process.env. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    // Print variable names and problems, never values (values may be secrets).
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
