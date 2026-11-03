import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema.ts'

/** Opens a connection pool to the given PostgreSQL database and wraps it in Drizzle. */
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString })
  const db = drizzle({ client: pool, schema })
  return { db, close: () => pool.end() }
}

export type Database = ReturnType<typeof createDatabase>['db']

/** A transaction opened on the database, as `db.transaction()` hands it to its callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Where a query runs: on the database itself or inside a transaction, so that a module can write
 * its rows in the same transaction as the change they belong to.
 */
export type Executor = Database | Transaction
