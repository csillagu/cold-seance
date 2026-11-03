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
