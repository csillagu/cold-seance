import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { is, sql } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { pushSchema } from 'drizzle-kit/api'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as schema from '../../src/db/schema.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

const journalFile = fileURLToPath(new URL('../../drizzle/meta/_journal.json', import.meta.url))

/** The tables the Drizzle schema declares, each with its columns, as `schema.table` keys. */
function declaredTables(): Map<string, string[]> {
  const tables = new Map<string, string[]>()
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue
    const config = getTableConfig(value)
    const columns = config.columns.map((column) => column.name).toSorted()
    tables.set(`${config.schema ?? 'public'}.${config.name}`, columns)
  }
  return tables
}

/** The migrations the journal lists, in the order the migrator applies them. */
function journalTags(): string[] {
  if (!existsSync(journalFile)) return []
  const journal: unknown = JSON.parse(readFileSync(journalFile, 'utf8'))
  const entries = typeof journal === 'object' && journal !== null && 'entries' in journal
  return entries && Array.isArray(journal.entries)
    ? journal.entries.map((entry: unknown) => String(Reflect.get(Object(entry), 'tag')))
    : []
}

// SC-073: the migrations, applied in order to an empty PostgreSQL database, give the schema's
// database. `createTestDatabase()` creates an empty database and applies every migration in the
// order of the journal, with Drizzle's migrator, as the service layer's tests do.
describe('the migrations applied to an empty database (SC-073)', () => {
  let x: TestDatabase

  beforeAll(async () => {
    x = await createTestDatabase()
  })

  afterAll(async () => {
    await x?.drop()
  })

  it('create exactly the tables the schema declares, with their columns', async () => {
    const result = await x.db.execute<{ name: string; column: string }>(sql`
      select c.table_schema || '.' || c.table_name as name, c.column_name as column
      from information_schema.columns c
      join information_schema.tables t using (table_schema, table_name)
      where t.table_type = 'BASE TABLE'
        and c.table_schema not in ('pg_catalog', 'information_schema', 'drizzle')
      order by c.column_name`)
    const created = new Map<string, string[]>()
    for (const row of result.rows)
      created.set(row.name, [...(created.get(row.name) ?? []), row.column])

    expect(Object.fromEntries(created)).toEqual(Object.fromEntries(declaredTables()))
  })

  it('differ in nothing from the schema: types, nullability, keys, indexes, enums', async () => {
    // What drizzle-kit would have to change to make this database match the schema. It catches
    // what the table and column names above do not, such as a committed migration edited by hand.
    const { statementsToExecute } = await pushSchema(schema, x.db)
    expect(statementsToExecute).toEqual([])
  })

  it('are each recorded as applied, once, so a later start applies only newer ones', async () => {
    const tags = journalTags()
    const table = await x.db.execute<{ found: boolean }>(
      sql`select to_regclass('drizzle.__drizzle_migrations') is not null as found`,
    )
    const found = table.rows[0]?.found === true
    // Until the first migration exists the migrator has nothing to run, and records nothing.
    const recorded = found
      ? await x.db
          .execute<{ count: number }>(
            sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
          )
          .then((result) => result.rows[0]?.count)
      : 0
    expect(found).toBe(tags.length > 0)
    expect(recorded).toBe(tags.length)
  })
})
