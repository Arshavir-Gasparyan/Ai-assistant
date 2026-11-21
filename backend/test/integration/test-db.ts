import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * The integration-test database URL: TEST_DATABASE_URL if set (e.g. in CI), otherwise
 * your DATABASE_URL from the root .env with the database name replaced by `knowledge_test`.
 */
export function testDatabaseUrl(): { testUrl: string; adminUrl: string; dbName: string } {
  if (!process.env.DATABASE_URL && existsSync(ROOT_ENV)) process.loadEnvFile(ROOT_ENV);

  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL (root .env) or TEST_DATABASE_URL to run integration tests');

  const url = new URL(base);
  const dbName = process.env.TEST_DATABASE_URL ? url.pathname.slice(1) : 'knowledge_test';
  const adminUrl = new URL(base);
  adminUrl.pathname = '/postgres'; // maintenance DB, used to CREATE DATABASE
  url.pathname = `/${dbName}`;
  return { testUrl: url.toString(), adminUrl: adminUrl.toString(), dbName };
}
