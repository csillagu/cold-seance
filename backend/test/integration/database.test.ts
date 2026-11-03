import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

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
