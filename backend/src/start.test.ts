import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../test/helpers/config.ts'
import { ConfigError } from './config/config.ts'
import { startBackend } from './start.ts'

let fx: ConfigFixture

beforeEach(() => {
  fx = createConfigFixture()
})

afterEach(() => {
  fx.remove()
})

describe('startBackend', () => {
  it('hands the loaded configuration to the backend and builds the application', async () => {
    const backend = startBackend({
      env: { COLD_SEANCE_DATABASE_URL: 'postgres://u:p@localhost:1/db', ...fx.githubEnv },
      cwd: fx.dir,
    })
    expect(backend.config.database.url).toBe('postgres://u:p@localhost:1/db')
    expect(backend.config.github.apps.readIssues.privateKey).toBe('key-readIssues')
    expect(backend.db).toBeDefined()
    const response = await backend.app.inject({ method: 'GET', url: '/no-such-route' })
    expect(response.statusCode).toBe(404)
    // Closing the application closes the database pool; no connection was opened, so this is quick.
    await backend.app.close()
    expect(backend.db.$client.ended).toBe(true)
  })

  it('refuses to start, naming the missing setting, before anything is opened', () => {
    expect(() => startBackend({ env: fx.githubEnv, cwd: fx.dir })).toThrow(ConfigError)
    expect(() => startBackend({ env: fx.githubEnv, cwd: fx.dir })).toThrow(
      'database.url (COLD_SEANCE_DATABASE_URL) is required but not set',
    )
  })
})
