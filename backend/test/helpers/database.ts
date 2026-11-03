import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { createDatabase, type Database } from '../../src/db/client.ts'
import { applyMigrations } from '../../src/db/migrate.ts'

/**
 * The PostgreSQL server the integration tests run against, as a connection URL to a database on
 * it that the tests may create and drop databases from (usually `postgres`).
 */
export function testServerUrl(): string {
  const url = process.env['TEST_DATABASE_URL']
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Point it at a PostgreSQL server the tests may create ' +
        'databases on, e.g. postgres://postgres:postgres@localhost:5432/postgres ' +
        '(`docker compose -f compose.test.yaml up -d` starts one).',
    )
  }
  return url
}

export interface TestDatabase {
  name: string
  url: string
  db: Database
  drop(): Promise<void>
}

/**
 * Creates a fresh, empty database with every migration applied by the backend's own migration
 * step (SC-074), as the test cases' "fresh test deployment: empty database" asks. Each call gets
 * its own database, so test files run in parallel without seeing each other's data. Call `drop()`
 * when done. `{ migrate: false }` leaves the database empty, for tests of the migration step.
 */
export async function createTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const serverUrl = testServerUrl()
  const name = `test_${randomUUID().replaceAll('-', '')}`
  await onServer(serverUrl, (client) => client.query(`CREATE DATABASE "${name}"`))

  const url = new URL(serverUrl)
  url.pathname = `/${name}`
  if (options.migrate !== false) {
    try {
      await applyMigrations(url.toString())
    } catch (error) {
      await onServer(serverUrl, (client) => client.query(`DROP DATABASE "${name}" WITH (FORCE)`))
      throw error
    }
  }
  const { db, close } = createDatabase(url.toString())

  return {
    name,
    url: url.toString(),
    db,
    async drop() {
      await close()
      await onServer(serverUrl, (client) => client.query(`DROP DATABASE "${name}" WITH (FORCE)`))
    },
  }
}

async function onServer(url: string, run: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await run(client)
  } finally {
    await client.end()
  }
}
