import pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';

export type Db = pg.Pool;

/**
 * A connection POOL, not a single connection.
 *
 * Opening a Postgres connection is expensive (TCP + auth handshake). A pool keeps a few
 * connections open and lends one to each query. `pool.query()` borrows and returns a
 * connection automatically. Creating the pool does not connect yet: connections are
 * opened lazily on the first query.
 */
export function createPool(connectionString: string, log: FastifyBaseLogger): Db {
  const pool = new pg.Pool({
    connectionString,
    max: 10, // upper bound on concurrent connections from this process
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000, // fail fast instead of hanging if the DB is unreachable
  });

  // An idle pooled connection can die (DB restart, network blip). Without this listener,
  // Node treats the emitted 'error' as unhandled and crashes the whole process.
  pool.on('error', (err) => log.error({ err }, 'Postgres pool error'));

  return pool;
}
