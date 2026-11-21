import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/**
 * A minimal SQL migration runner.
 *
 * - Migrations are plain .sql files in backend/migrations, applied in filename order
 *   (001_..., 002_...). Each file runs exactly once.
 * - Applied migrations are recorded in the `schema_migrations` table.
 * - Each file runs in its own transaction: it applies fully or not at all.
 * - A Postgres advisory lock ensures that two processes starting at the same time
 *   (e.g. two API containers on AWS) don't apply the same migration twice.
 *
 * Rule: never edit a migration that has already been applied anywhere. Add a new one.
 */

// Resolves to backend/migrations from both src/db/ (tsx) and dist/db/ (compiled).
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

// Arbitrary app-specific number identifying "the migration lock".
const MIGRATION_LOCK_ID = 727_001;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const alreadyApplied = new Set(rows.map((r) => r.name));

    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const result: MigrationResult = { applied: [], skipped: [] };

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const sql = await readFile(`${dir}/${file}`, 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }

    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}
