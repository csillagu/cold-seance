import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startBackend } from '../../src/start.ts'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// TC-259 (FR-177), the part SC-109 and SC-074 support: the backend uses the database whose address
// is in its configuration, here a database on the test server standing in for the external one,
// and applies its migrations there (migration-step.test.ts). Still
// pending: signing in as the first system admin (SC-053), creating and listing a project (SC-017,
// and a project listing no SC names yet), and the two installs with the bundled database
// stopped (SC-029). The image's part, two installs of it on one external database, is in
// test/image/image.test.ts (SC-028).
describe('TC-259: the tool stores its data in the PostgreSQL database given in its configuration', () => {
  let x: TestDatabase
  let fx: ConfigFixture

  beforeAll(async () => {
    x = await createTestDatabase()
    fx = createConfigFixture()
  })

  afterAll(async () => {
    fx?.remove()
    await x?.drop()
  })

  async function currentDatabase(backend: Awaited<ReturnType<typeof startBackend>>) {
    try {
      const result = await backend.db.execute<{ name: string }>(
        sql`select current_database() as name`,
      )
      return result.rows[0]?.name
    } finally {
      await backend.app.close()
    }
  }

  it('TC-259: uses the database whose address is given in the configuration file', async () => {
    const path = fx.write('config.yaml', `database:\n  url: ${x.url}\n`)
    const backend = await startBackend({
      env: { COLD_SEANCE_CONFIG_FILE: path, ...fx.githubEnv },
      cwd: fx.dir,
    })
    expect(await currentDatabase(backend)).toBe(x.name)
  })

  it('TC-259: uses the address given by the environment over the one in the file', async () => {
    // The file names a database that is not running, as an install's own database would be when stopped.
    const path = fx.write(
      'stopped.yaml',
      'database:\n  url: postgres://postgres:postgres@127.0.0.1:1/installed\n',
    )
    const backend = await startBackend({
      env: { COLD_SEANCE_CONFIG_FILE: path, COLD_SEANCE_DATABASE_URL: x.url, ...fx.githubEnv },
      cwd: fx.dir,
    })
    expect(await currentDatabase(backend)).toBe(x.name)
  })
})
