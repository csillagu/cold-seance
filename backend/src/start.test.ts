import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../test/helpers/config.ts'
import { migrationError } from '../test/helpers/migrations.ts'
import { ConfigError } from './config/config.ts'
import { startBackend } from './start.ts'

// The start that succeeds needs a database to migrate, so it is tested in
// test/integration/migration-step.test.ts; these are the refusals that need none.

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
  it('refuses to start, naming the missing setting, before anything is opened', async () => {
    await expect(startBackend({ env: fx.githubEnv, cwd: fx.dir })).rejects.toThrow(ConfigError)
    await expect(startBackend({ env: fx.githubEnv, cwd: fx.dir })).rejects.toThrow(
      'database.url (COLD_SEANCE_DATABASE_URL) is required but not set',
    )
  })

  it('refuses to start when its own migrations cannot be applied to the configured database', async () => {
    const { message } = await migrationError(
      startBackend({
        env: { COLD_SEANCE_DATABASE_URL: unreachable, ...fx.githubEnv },
        cwd: fx.dir,
      }),
    )
    expect(message).toContain('ECONNREFUSED')
  })

  it('migrates over the direct connection when one is configured', async () => {
    // The pooled address is fine; only the direct one is unreachable, and the start is refused.
    const { message } = await migrationError(
      startBackend({
        env: {
          COLD_SEANCE_DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/db',
          COLD_SEANCE_DATABASE_DIRECT_URL: unreachable,
          ...fx.githubEnv,
        },
        cwd: fx.dir,
      }),
    )
    expect(message).toContain('ECONNREFUSED 127.0.0.1:1')
  })
})
