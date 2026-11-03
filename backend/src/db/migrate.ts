import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Client } from 'pg'

/**
 * The migrations drizzle-kit generates from the schema (SC-073), `backend/drizzle/`. The path is
 * the same from `src/db/` and from the built `dist/db/`.
 */
export const defaultMigrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url))

/** The pending migrations could not be applied, so the backend does not start (SC-074). */
export class MigrationError extends Error {
  constructor(cause: unknown) {
    super(
      `The database migrations could not be applied, so the tool does not start: ${reason(cause)}`,
      { cause },
    )
    this.name = 'MigrationError'
  }
}

/**
 * The migration step of the backend's start (SC-074, DD-057): applies the migrations in
 * `migrationsFolder` that the database has not recorded yet, with Drizzle's migrator, over one
 * direct connection to `directUrl` that is closed again before the step returns. Drizzle runs the
 * pending migrations in one transaction, so a failure leaves the database as it was; the step then
 * throws a `MigrationError` and the backend must not start.
 *
 * A folder without a journal holds no migrations: the schema has no table yet (SC-073), so there
 * is nothing to apply and the database is not contacted.
 */
export async function applyMigrations(
  directUrl: string,
  migrationsFolder: string = defaultMigrationsFolder,
): Promise<void> {
  if (!existsSync(join(migrationsFolder, 'meta', '_journal.json'))) return

  const client = new Client({ connectionString: directUrl })
  try {
    await client.connect()
    await migrate(drizzle({ client }), { migrationsFolder })
  } catch (error) {
    throw new MigrationError(error)
  } finally {
    await client.end().catch(() => {})
  }
}

/**
 * The error's own message, and its cause's, which is where Drizzle puts PostgreSQL's reason. A
 * connection refused on every address of a host comes as an `AggregateError` with no message, so
 * its code stands in.
 */
function reason(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? `: ${describe(error.cause)}` : ''
  return `${describe(error)}${cause}`
}

function describe(error: Error): string {
  if (error.message !== '') return error.message
  return 'code' in error && typeof error.code === 'string' ? error.code : error.name
}
