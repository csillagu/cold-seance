import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accounts } from '../../src/db/schema.ts'
import { FirstAdminError, setUpFirstAdmin } from '../../src/service/first-admin.ts'
import { startBackend } from '../../src/start.ts'
import { seedAccount } from '../helpers/accounts.ts'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { argon2idMatches } from '../helpers/passwords.ts'

// The first system admin bootstrap (SC-053) against a real PostgreSQL: the step itself, then the
// backend's start with the first system admin given by environment variables (FR-165, TC-240).

let x: TestDatabase

beforeEach(async () => {
  x = await createTestDatabase()
})

afterEach(async () => {
  await x?.drop()
})

const ROOT = { username: 'root', password: 'root-correct-horse' }

describe('setUpFirstAdmin', () => {
  it('creates the first system admin, with the password kept as its Argon2id hash, while there is none', async () => {
    expect(await setUpFirstAdmin(x.db, ROOT)).toBe('created')
    const rows = await x.db.select().from(accounts)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ username: 'root', systemAdmin: true })
    expect(argon2idMatches(rows[0]!.passwordHash, ROOT.password)).toBe(true)
  })

  it('changes nothing once a system admin exists, even with other settings', async () => {
    await setUpFirstAdmin(x.db, ROOT)
    expect(await setUpFirstAdmin(x.db, ROOT)).toBe('exists')
    expect(await setUpFirstAdmin(x.db, { username: 'other', password: 'pw' })).toBe('exists')
    expect((await x.db.select().from(accounts)).map((a) => a.username)).toEqual(['root'])
  })

  it('counts any system admin, not only one it created', async () => {
    await seedAccount(x.db, { username: 'admin', systemAdmin: true })
    expect(await setUpFirstAdmin(x.db, ROOT)).toBe('exists')
    expect(await x.db.select().from(accounts).where(eq(accounts.username, 'root'))).toEqual([])
  })

  it('keeps the username as any account keeps it: trimmed', async () => {
    await setUpFirstAdmin(x.db, { username: '  root  ', password: 'pw' })
    expect((await x.db.select().from(accounts)).map((a) => a.username)).toEqual(['root'])
  })

  it.each([
    [{ username: '   ', password: 'pw' }, 'A username is required'],
    [{ username: 'root', password: '' }, 'A password is required'],
    [{ username: 'r'.repeat(101), password: 'pw' }, 'A username can have at most 100 characters'],
  ])('refuses settings no account could have, and creates nothing', async (given, message) => {
    const error = await setUpFirstAdmin(x.db, given).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FirstAdminError)
    expect(error).toHaveProperty(
      'message',
      `The first system admin cannot be set up, so the tool does not start: ${message}`,
    )
    expect(await x.db.select().from(accounts)).toEqual([])
  })

  it('refuses a username an account that is not a system admin already has, in any case', async () => {
    await seedAccount(x.db, { username: 'Root' })
    const error = await setUpFirstAdmin(x.db, ROOT).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FirstAdminError)
    expect(error).toHaveProperty(
      'message',
      expect.stringContaining('the account root exists already and is not a system admin'),
    )
    const rows = await x.db.select().from(accounts)
    expect(rows.map((a) => [a.username, a.systemAdmin])).toEqual([['Root', false]])
  })

  it('creates the first system admin once when two backends start at the same moment', async () => {
    const outcomes = await Promise.all([setUpFirstAdmin(x.db, ROOT), setUpFirstAdmin(x.db, ROOT)])
    expect(outcomes.sort()).toEqual(['created', 'exists'])
    expect(await x.db.select().from(accounts)).toHaveLength(1)
  })
})

describe('the start', () => {
  let fx: ConfigFixture

  beforeEach(() => {
    fx = createConfigFixture()
  })

  afterEach(() => {
    fx.remove()
  })

  const env = (extra: Record<string, string> = {}) => ({
    COLD_SEANCE_DATABASE_URL: x.url,
    ...fx.githubEnv,
    ...extra,
  })

  describe('TC-240: the first system admin comes from an environment variable', () => {
    it('creates root at start, and root signs in and creates alice', async () => {
      const backend = await startBackend({
        env: env({
          COLD_SEANCE_FIRST_ADMIN_USERNAME: 'root',
          COLD_SEANCE_FIRST_ADMIN_PASSWORD: ROOT.password,
        }),
        cwd: fx.dir,
      })
      try {
        // Negative: no other account exists before step 2.
        expect((await x.db.select().from(accounts)).map((a) => a.username)).toEqual(['root'])

        // Step 2: root signs in...
        const signedIn = await backend.app.inject({
          method: 'POST',
          url: '/api/session',
          payload: { username: 'root', password: ROOT.password },
        })
        expect(signedIn.statusCode).toBe(204)
        // ...and creates alice through that session, which only a system admin can.
        const cookie = String(signedIn.headers['set-cookie']).split(';')[0]!
        const created = await backend.app.inject({
          method: 'POST',
          url: '/api/accounts',
          headers: { cookie },
          payload: { username: 'alice', password: 'alice-pw' },
        })
        expect(created.statusCode).toBe(201)
        expect(created.json()).toMatchObject({ username: 'alice', systemAdmin: false })
      } finally {
        await backend.app.close()
      }
    })

    // Pending: TC-240 in full: root signs in and creates alice on the pages (SC-075, SC-076).
  })

  it('starts without creating anyone when no first system admin is given', async () => {
    const backend = await startBackend({ env: env(), cwd: fx.dir })
    await backend.app.close()
    expect(await x.db.select().from(accounts)).toEqual([])
  })

  it('does not start when the first system admin cannot be created, creates nothing and lets go of the database', async () => {
    await seedAccount(x.db, { username: 'root' })
    const connections = async () =>
      (
        await x.db.execute<{ n: number }>(
          sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()`,
        )
      ).rows[0]!.n
    const before = await connections()
    await expect(
      startBackend({
        env: env({
          COLD_SEANCE_FIRST_ADMIN_USERNAME: 'root',
          COLD_SEANCE_FIRST_ADMIN_PASSWORD: ROOT.password,
        }),
        cwd: fx.dir,
      }),
    ).rejects.toThrow(FirstAdminError)
    const rows = await x.db.select().from(accounts)
    expect(rows.map((a) => [a.username, a.systemAdmin])).toEqual([['root', false]])
    // The backend's own pool is closed: no connection of it is left open.
    expect(await connections()).toBeLessThanOrEqual(before)
  })

  it('stops the server with one clear line, not an error and its stack', () => {
    const settings = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith('COLD_SEANCE_')),
    )
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../src/server.ts', import.meta.url))],
      {
        cwd: fx.dir,
        env: {
          ...settings,
          ...env({
            COLD_SEANCE_FIRST_ADMIN_USERNAME: '   ',
            COLD_SEANCE_FIRST_ADMIN_PASSWORD: 'secret-first-password',
          }),
        },
        encoding: 'utf8',
        timeout: 20_000,
      },
    )
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'The first system admin cannot be set up, so the tool does not start: A username is required',
    )
    expect(result.stderr).not.toContain('    at ')
    expect(result.stderr).not.toContain('secret-first-password')
  })
})
