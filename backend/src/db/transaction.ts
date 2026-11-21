import type pg from 'pg';

/**
 * Run `fn` inside a transaction on ONE dedicated connection.
 *
 * Why a dedicated client: `pool.query()` may use a different connection for each call,
 * and BEGIN on connection A doesn't cover a query that runs on connection B.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
