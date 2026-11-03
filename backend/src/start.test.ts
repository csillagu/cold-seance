import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.ts'
import { createConfigFixture, type ConfigFixture } from '../test/helpers/config.ts'
import { migrationError } from '../test/helpers/migrations.ts'
import { ConfigError } from './config/config.ts'
import { closeOnSignals, startBackend } from './start.ts'

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

describe('closeOnSignals', () => {
  it('closes the backend on SIGTERM, as docker stop sends, and stops listening for signals', async () => {
    const app = buildApp()
    const closed = vi.fn<() => void>()
    app.addHook('onClose', async () => closed())
    await app.ready()
    const target = new EventEmitter()
    closeOnSignals(app, undefined, target)
    expect(target.listenerCount('SIGTERM')).toBe(1)
    expect(target.listenerCount('SIGINT')).toBe(1)

    target.emit('SIGTERM', 'SIGTERM')
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    expect(target.listenerCount('SIGTERM')).toBe(0)
    expect(target.listenerCount('SIGINT')).toBe(0)
  })

  it('closes the backend on the first of the given signals only', async () => {
    const app = buildApp()
    const close = vi.spyOn(app, 'close')
    const target = new EventEmitter()
    closeOnSignals(app, ['SIGINT'], target)
    expect(target.listenerCount('SIGTERM')).toBe(0)
    target.emit('SIGINT', 'SIGINT')
    target.emit('SIGINT', 'SIGINT')
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('sets a failing exit code when the backend cannot be closed cleanly', async () => {
    const app = buildApp()
    vi.spyOn(app, 'close').mockRejectedValue(new Error('pool would not end'))
    const logged = vi.spyOn(app.log, 'error')
    const target = new EventEmitter()
    const before = process.exitCode
    try {
      closeOnSignals(app, ['SIGTERM'], target)
      target.emit('SIGTERM', 'SIGTERM')
      await vi.waitFor(() => expect(process.exitCode).toBe(1))
      expect(logged).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'pool would not end' }),
        'The backend could not be closed cleanly',
      )
    } finally {
      process.exitCode = before
    }
  })
})
