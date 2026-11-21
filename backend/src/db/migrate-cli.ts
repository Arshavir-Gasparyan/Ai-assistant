/**
 * `npm run migrate` locally, or the one-shot `migrate` service in docker compose.
 * Needs only DATABASE_URL, so it doesn't validate the rest of the API's config.
 */
import pg from 'pg';
import { envSchema } from '../config/env.js';
import { runMigrations } from './migrate.js';

const parsed = envSchema.pick({ DATABASE_URL: true }).safeParse(process.env);
if (!parsed.success) {
  console.error('DATABASE_URL is missing or invalid');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: parsed.data.DATABASE_URL, connectionTimeoutMillis: 5_000 });

try {
  const { applied, skipped } = await runMigrations(pool);
  console.log(`Migrations: ${applied.length} applied, ${skipped.length} already up to date`);
  for (const name of applied) console.log(`  + ${name}`);
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
