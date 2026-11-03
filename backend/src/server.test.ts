import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigFixture, type ConfigFixture } from '../test/helpers/config.ts'

const server = fileURLToPath(new URL('./server.ts', import.meta.url))

let fx: ConfigFixture

beforeEach(() => {
  fx = createConfigFixture()
})

afterEach(() => {
  fx.remove()
})

describe('server', () => {
  it('stops the start with a message naming the missing setting', () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('COLD_SEANCE_')),
    )
    const result = spawnSync(process.execPath, [server], {
      cwd: fx.dir,
      env: { ...env, ...fx.githubEnv },
      encoding: 'utf8',
      timeout: 20_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('The configuration is not valid, so the tool does not start')
    expect(result.stderr).toContain(
      'database.url (COLD_SEANCE_DATABASE_URL) is required but not set',
    )
  })
})

describe('server', () => {
  it("stops the start with the migration step's message when the migrations cannot be applied", () => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('COLD_SEANCE_')),
    )
    const result = spawnSync(process.execPath, [server], {
      cwd: fx.dir,
      env: {
        ...env,
        ...fx.githubEnv,
        // Nothing listens on port 1, so the migration step's connection is refused.
        COLD_SEANCE_DATABASE_URL: 'postgres://u:secret-password@127.0.0.1:1/db',
      },
      encoding: 'utf8',
      timeout: 20_000,
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'The database migrations could not be applied, so the tool does not start: connect ECONNREFUSED 127.0.0.1:1',
    )
    // A clean message, not an uncaught error with its stack, and no password.
    expect(result.stderr).not.toContain('    at ')
    expect(result.stderr).not.toContain('secret-password')
  })
})
