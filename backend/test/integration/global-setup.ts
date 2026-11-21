import pg from 'pg';
import { runMigrations } from '../../src/db/migrate.js';
import { testDatabaseUrl } from './test-db.js';

/** Runs once before all integration tests: create the test database and migrate it. */
export default async function setup() {
  const { testUrl, adminUrl, dbName } = testDatabaseUrl();

  const admin = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 3000 });
  try {
    await admin.connect();
  } catch {
    throw new Error(`Cannot reach PostgreSQL for integration tests. Is it running? (docker compose up -d postgres)`);
  }
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (rowCount === 0) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await admin.end();

  const pool = new pg.Pool({ connectionString: testUrl });
  await runMigrations(pool);
  await pool.end();
}
