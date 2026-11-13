import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { createDatabase } from '../../src/db/client.ts'
import { createTestDatabase, type TestDatabase, testServerUrl } from '../helpers/database.ts'

describe('test databases', () => {
  let first: TestDatabase
  let second: TestDatabase

  beforeAll(async () => {
    first = await createTestDatabase()
    second = await createTestDatabase()
  })

  afterAll(async () => {
    await first?.drop()
    await second?.drop()
  })

  it('connects to its own database', async () => {
    const result = await first.db.execute<{ name: string }>(sql`select current_database() as name`)
    expect(result.rows[0]?.name).toBe(first.name)
  })

  it('does not see what another test database holds', async () => {
    await first.db.execute(sql`create table probe (id integer)`)
    const result = await second.db.execute<{ count: number }>(
      sql`select count(*)::int as count from information_schema.tables where table_name = 'probe'`,
    )
    expect(result.rows[0]?.count).toBe(0)
  })
})

describe('closing a database', () => {
  let target: TestDatabase

  beforeAll(async () => {
    target = await createTestDatabase()
  })

  afterAll(async () => {
    await target?.drop()
  })

  it('resolves only once every connection of its pool has ended', async () => {
    // A pool with several connections at once, then closed: none of them may still be open on the
    // server, or a database dropped right after kills one that is still closing.
    const url = new URL(target.url)
    url.searchParams.set('application_name', 'closing-probe')
    const { db, close } = createDatabase(url.toString())
    const server = new Client({ connectionString: testServerUrl() })
    await server.connect()
    try {
      await Promise.all(Array.from({ length: 5 }, () => db.execute(sql`select pg_sleep(0.05)`)))
      await close()
      // Asked at once, over a connection already open, as a drop right after would act.
      const result = await server.query<{ count: number }>(
        "select count(*)::int as count from pg_stat_activity where application_name = 'closing-probe'",
      )
      expect(result.rows[0]?.count).toBe(0)
    } finally {
      await server.end()
    }
  })
})
