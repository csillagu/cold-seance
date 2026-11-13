import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.ts'

/**
 * Opens a connection pool to the given PostgreSQL database and wraps it in Drizzle. `close()`
 * resolves once every connection of the pool has ended, not merely once the pool has begun to end
 * them, as `pool.end()` does: a database dropped right after (as the tests drop theirs `WITH
 * (FORCE)`) would otherwise terminate a connection still closing, whose client, no longer the
 * pool's, has no one to hand that error to, so that it is thrown in whatever runs then.
 */
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString })
  const open = new Set<unknown>()
  pool.on('connect', (client) => open.add(client))
  // Emitted once a client the pool let go of has ended its connection.
  pool.on('remove', (client) => open.delete(client))
  const allEnded = new Promise<void>((resolve) => {
    pool.on('remove', () => {
      if (pool.ending && open.size === 0) resolve()
    })
  })
  const db = drizzle({ client: pool, schema })
  return {
    db,
    close: async () => {
      await pool.end()
      // Each connection still ending is removed from `open` as it ends; the last one resolves it.
      if (open.size > 0) await allEnded
    },
  }
}

export type Database = ReturnType<typeof createDatabase>['db']

/** A transaction opened on the database, as `db.transaction()` hands it to its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Where a query runs: on the database itself or inside a transaction, so that a module can write
 * its rows in the same transaction as the change they belong to.
 */
export type Executor = Database | Transaction
