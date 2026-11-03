import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { defaultMigrationsFolder, migrationApplicationName } from '../../src/db/migrate.ts'
import { startBackend } from '../../src/start.ts'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import {
  migrationError,
  removeMigrationsFolder,
  writeMigrationsFolder,
  type FixtureMigration,
} from '../helpers/migrations.ts'

// SC-074: the step in the backend's start that applies the pending migrations, over the direct
// connection, before the backend serves requests. Each test gets an empty database with none of
// the backend's own migrations in it, and migrations folders standing for successive releases.

// Nothing listens on port 1, so a connection to it is refused at once.
const unreachable = 'postgres://postgres:postgres@127.0.0.1:1/installed'

const release1: FixtureMigration[] = [
  {
    tag: '0000_people',
    when: 1_000,
    statements: ['CREATE TABLE "people" ("id" integer PRIMARY KEY, "name" text NOT NULL)'],
  },
]
const release2: FixtureMigration[] = [
  ...release1,
  {
    tag: '0001_projects',
    when: 2_000,
    statements: [
      'CREATE TABLE "projects" ("id" integer PRIMARY KEY)',
      'ALTER TABLE "people" ADD COLUMN "email" text',
    ],
  },
]
/** Release 2 plus a migration whose second statement fails. */
const brokenRelease: FixtureMigration[] = [
  ...release2,
  {
    tag: '0002_broken',
    when: 3_000,
    statements: [
      'CREATE TABLE "calendars" ("id" integer PRIMARY KEY)',
      'ALTER TABLE "no_such_table" ADD COLUMN "x" integer',
    ],
  },
]

let x: TestDatabase
let fx: ConfigFixture
const folders: string[] = []

function folder(migrations: readonly FixtureMigration[]): string {
  const path = writeMigrationsFolder(migrations)
  folders.push(path)
  return path
}

beforeAll(() => {
  fx = createConfigFixture()
})

afterAll(() => {
  fx?.remove()
})

beforeEach(async () => {
  x = await createTestDatabase({ migrate: false })
})

afterEach(async () => {
  for (const path of folders.splice(0)) removeMigrationsFolder(path)
  await x?.drop()
})

/** Starts the backend on `x`, or on the given addresses, with the given migrations. */
function start(migrationsFolder: string, database: { url?: string; directUrl?: string } = {}) {
  return startBackend({
    env: {
      COLD_SEANCE_DATABASE_URL: database.url ?? x.url,
      ...(database.directUrl === undefined
        ? {}
        : { COLD_SEANCE_DATABASE_DIRECT_URL: database.directUrl }),
      ...fx.githubEnv,
    },
    cwd: fx.dir,
    migrationsFolder,
  })
}

async function tables(): Promise<string[]> {
  const result = await x.db.execute<{ name: string }>(
    sql`select table_name as name from information_schema.tables
        where table_schema = 'public' order by table_name`,
  )
  return result.rows.map((row) => row.name)
}

async function columns(table: string): Promise<string[]> {
  const result = await x.db.execute<{ name: string }>(
    sql`select column_name as name from information_schema.columns
        where table_schema = 'public' and table_name = ${table} order by column_name`,
  )
  return result.rows.map((row) => row.name)
}

/** The migration step's connections still open on `x`; the step must close its own. */
async function migrationConnections(): Promise<number> {
  // A backend that has just closed its connection may take a moment to leave the view.
  for (let attempt = 0; ; attempt++) {
    const result = await x.db.execute<{ count: number }>(
      sql`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and application_name = ${migrationApplicationName}`,
    )
    const count = result.rows[0]!.count
    if (count === 0 || attempt === 20) return count
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function recorded(): Promise<number> {
  const result = await x.db.execute<{ count: number }>(
    sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
  )
  return result.rows[0]!.count
}

describe('the migration step at the start of the backend (SC-074)', () => {
  it('applies every migration to an empty database before the backend is handed over', async () => {
    const backend = await start(folder(release2))
    // The schema is complete the moment the start resolves, before anything listens.
    expect(backend.app.server.listening).toBe(false)
    expect(await tables()).toEqual(['people', 'projects'])
    expect(await columns('people')).toEqual(['email', 'id', 'name'])
    expect(await recorded()).toBe(2)
    // The step's direct connection is closed again; the backend serves over its pool.
    expect(await migrationConnections()).toBe(0)
    await backend.app.close()
  })

  it("applies the backend's own migrations folder unless told otherwise", async () => {
    const backend = await startBackend({
      env: { COLD_SEANCE_DATABASE_URL: x.url, ...fx.githubEnv },
      cwd: fx.dir,
    })
    // Every migration in the backend's own journal is recorded as applied, and nothing else.
    const journal: unknown = JSON.parse(
      readFileSync(join(defaultMigrationsFolder, 'meta', '_journal.json'), 'utf8'),
    )
    const entries: unknown = Reflect.get(Object(journal), 'entries')
    if (!Array.isArray(entries)) throw new Error('the journal lists no entries')
    expect(await recorded()).toBe(entries.length)
    await backend.app.close()
  })

  it('brings an older database up to date when a new version starts, before the first request', async () => {
    const old = await start(folder(release1))
    await old.app.close()
    expect(await tables()).toEqual(['people'])
    expect(await columns('people')).toEqual(['id', 'name'])

    const upgraded = await start(folder(release2))
    expect(upgraded.app.server.listening).toBe(false)
    expect(await tables()).toEqual(['people', 'projects'])
    expect(await columns('people')).toEqual(['email', 'id', 'name'])
    expect(await recorded()).toBe(2)

    // The first request is answered by the upgraded backend, on the upgraded schema.
    const response = await upgraded.app.inject({ method: 'GET', url: '/api/openapi.json' })
    expect(response.statusCode).toBe(401)
    const people = await upgraded.db.execute(sql`select "email" from "people"`)
    expect(people.rows).toEqual([])
    await upgraded.app.close()
  })

  it('applies nothing again on a start whose migrations are all applied', async () => {
    const path = folder(release2)
    await (await start(path)).app.close()
    await x.db.execute(sql`insert into "people" ("id", "name") values (1, 'Ada')`)

    await (await start(path)).app.close()
    expect(await recorded()).toBe(2)
    const people = await x.db.execute(sql`select "name" from "people"`)
    expect(people.rows).toEqual([{ name: 'Ada' }])
  })

  it('refuses the start when a migration fails, and leaves the database as it was', async () => {
    await (await start(folder(release1))).app.close()

    const error = await migrationError(start(folder(brokenRelease)))
    expect(error.message).toContain('relation "no_such_table" does not exist')

    // The pending migrations run in one transaction: neither release 2 nor the broken migration's
    // first statement is left behind, and only release 1 is recorded.
    expect(await tables()).toEqual(['people'])
    expect(await columns('people')).toEqual(['id', 'name'])
    expect(await recorded()).toBe(1)
    expect(await migrationConnections()).toBe(0)
  })

  it('refuses the start when the migrations folder has no journal, as in an image built without it', async () => {
    const path = folder(release1)
    removeMigrationsFolder(`${path}/meta`)
    const error = await migrationError(start(path))
    expect(error.message).toContain("Can't find meta/_journal.json file")
    expect(await tables()).toEqual([])
  })

  it('refuses the start when a migration in the journal has no SQL file', async () => {
    const path = folder(release2)
    removeMigrationsFolder(`${path}/0001_projects.sql`)
    const error = await migrationError(start(path))
    expect(error.message).toContain('0001_projects.sql')
    expect(await tables()).toEqual([])
  })

  it('migrates over the direct connection, not the pooled address', async () => {
    // The pooled address is not reachable, so the migrations can only have gone over the direct one.
    const backend = await start(folder(release1), { url: unreachable, directUrl: x.url })
    expect(await tables()).toEqual(['people'])
    await backend.app.close()
  })

  it('refuses the start when the direct connection cannot be reached, even if the pooled one can', async () => {
    const error = await migrationError(start(folder(release1), { directUrl: unreachable }))
    expect(error.message).toContain('ECONNREFUSED')
    expect(await tables()).toEqual([])
  })

  it('TC-259: applies the migrations to the database whose address is given in the configuration', async () => {
    // The part of TC-259 this SC supports: database X, given in the configuration file, is the one
    // that gets the tool's schema. The install's own database being stopped is covered in
    // config-database.test.ts and, for the real install, pending on SC-028 and SC-029.
    const path = fx.write('x.yaml', `database:\n  url: ${x.url}\n`)
    const backend = await startBackend({
      env: { COLD_SEANCE_CONFIG_FILE: path, ...fx.githubEnv },
      cwd: fx.dir,
      migrationsFolder: folder(release1),
    })
    expect(await tables()).toEqual(['people'])
    await backend.app.close()
  })
})
