import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../test/helpers/config.ts'
import { removeMigrationsFolder, writeMigrationsFolder } from '../test/helpers/migrations.ts'
import { ConfigError } from './config/config.ts'
import { MigrationError } from './db/migrate.ts'
import { startBackend } from './start.ts'

let fx: ConfigFixture

beforeEach(() => {
  fx = createConfigFixture()
})

afterEach(() => {
  fx.remove()
})

// Nothing listens on port 1, so a connection to it is refused at once.
const unreachable = 'postgres://u:p@127.0.0.1:1/db'

describe('startBackend', () => {
  it('hands the loaded configuration to the backend and builds the application', async () => {
    // A folder without a journal holds no migrations, so the database is not contacted.
    const backend = await startBackend({
      env: { COLD_SEANCE_DATABASE_URL: unreachable, ...fx.githubEnv },
      cwd: fx.dir,
      migrationsFolder: fx.dir,
    })
    expect(backend.config.database.url).toBe(unreachable)
    expect(backend.config.github.apps.readIssues.privateKey).toBe('key-readIssues')
    expect(backend.db).toBeDefined()
    const response = await backend.app.inject({ method: 'GET', url: '/no-such-route' })
    expect(response.statusCode).toBe(404)
    // Closing the application closes the database pool; no connection was opened, so this is quick.
    await backend.app.close()
    expect(backend.db.$client.ended).toBe(true)
  })

  it("applies the backend's own migrations unless told otherwise", async () => {
    // The schema has no migration yet (SC-073), so there is nothing to apply and nothing to reach.
    const backend = await startBackend({
      env: { COLD_SEANCE_DATABASE_URL: unreachable, ...fx.githubEnv },
      cwd: fx.dir,
    })
    expect(backend.config.database.directUrl).toBe(unreachable)
    await backend.app.close()
  })

  it('refuses to start, naming the missing setting, before anything is opened', async () => {
    await expect(startBackend({ env: fx.githubEnv, cwd: fx.dir })).rejects.toThrow(ConfigError)
    await expect(startBackend({ env: fx.githubEnv, cwd: fx.dir })).rejects.toThrow(
      'database.url (COLD_SEANCE_DATABASE_URL) is required but not set',
    )
  })

  it('refuses to start when the migrations cannot be applied, and opens no pool', async () => {
    const folder = writeMigrationsFolder([
      { tag: '0000_t', when: 1, statements: ['CREATE TABLE "t" ("id" integer)'] },
    ])
    try {
      await expect(
        startBackend({
          env: { COLD_SEANCE_DATABASE_URL: unreachable, ...fx.githubEnv },
          cwd: fx.dir,
          migrationsFolder: folder,
        }),
      ).rejects.toThrow(MigrationError)
    } finally {
      removeMigrationsFolder(folder)
    }
  })
})
