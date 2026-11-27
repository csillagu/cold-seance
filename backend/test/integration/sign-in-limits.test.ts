import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { sessions } from '../../src/db/schema.ts'
import { SessionService } from '../../src/service/sessions.ts'
import { createServices } from '../../src/service/services.ts'
import { startBackend, type Backend } from '../../src/start.ts'
import { seedAccount } from '../helpers/accounts.ts'
import { createConfigFixture, type ConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// The sign-in limits (SC-132) against a real PostgreSQL: the test cases of FR-215 and FR-216.

const C = { username: 'alice', password: 'alice-C' }
const W = { username: 'alice', password: 'alice-W' }

type App = ReturnType<typeof buildApp>

/**
 * A sign-in attempt from `remoteAddress`, with `X-Forwarded-For` naming `forwardedFor` if given.
 * It is sent at once, since `inject` sends only once its answer is awaited.
 */
async function attempt(
  app: App,
  remoteAddress: string,
  credentials: { username: string; password: string },
  forwardedFor?: string,
) {
  return await app.inject({
    method: 'POST',
    url: '/api/session',
    remoteAddress,
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    payload: credentials,
  })
}

async function sessionCount(x: TestDatabase): Promise<number> {
  return (await x.db.select().from(sessions)).length
}

describe('TC-289: an address past 10 sign-in attempts in 60 seconds is refused, and others are not', () => {
  let x: TestDatabase
  let app: App

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { services: createServices(x.db) })
    await seedAccount(x.db, C)
    // Only Date is faked, so the clock moves only when the test says, and nothing else waits.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-03-01T09:00:00Z') })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await app?.close()
    await x?.drop()
  })

  it('refuses A from its 11th attempt, signs B in, and lets A in a minute later', async () => {
    const A = '198.51.100.1'
    const B = '198.51.100.2'
    const start = Date.now()

    // Step 1: 10 attempts from A with W, within 10 seconds.
    for (let i = 0; i < 10; i++) {
      expect((await attempt(app, A, W)).statusCode).toBe(401)
      vi.setSystemTime(start + (i + 1) * 1_000)
    }
    const before = await sessionCount(x)

    // Step 2: A with C, at once: refused before its password is checked.
    const refused = await attempt(app, A, C)
    expect(refused.statusCode).toBe(429)
    expect(refused.json()).toEqual({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many sign-in attempts. Wait a minute and try again.',
    })
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
    expect(refused.headers['set-cookie']).toBeUndefined()

    // Step 3: B with C signs alice in.
    expect((await attempt(app, B, C)).statusCode).toBe(204)

    // Step 4: 5 more attempts from A with C, refused.
    for (let i = 0; i < 5; i++) expect((await attempt(app, A, C)).statusCode).toBe(429)
    expect(await sessionCount(x)).toBe(before + 1)

    // Step 5: 61 seconds after the first attempt of step 1, A with C signs alice in.
    vi.setSystemTime(start + 61_000)
    expect((await attempt(app, A, C)).statusCode).toBe(204)
  })
})

describe('TC-290: a sign-in made while 4 password checks run is refused at once', () => {
  let x: TestDatabase
  let app: App
  let checksStarted = 0
  let release: () => void = () => {}

  beforeEach(async () => {
    x = await createTestDatabase()
    const services = createServices(x.db)
    const held = new Promise<void>((resolve) => (release = resolve))
    // A deployment whose password check of a sign-in does not end until the test releases it.
    class HeldSessions extends SessionService {
      override async signIn(credentials: { username: string; password: string }) {
        checksStarted += 1
        await held
        return super.signIn(credentials)
      }
    }
    const sessionsHeld = new HeldSessions(x.db)
    app = buildApp({}, { services: { ...services, sessions: sessionsHeld } })
    await seedAccount(x.db, C)
    checksStarted = 0
  })

  afterEach(async () => {
    release()
    await app?.close()
    await x?.drop()
  })

  it('refuses A5 while A1 to A4 are checked, and signs A6 in after', async () => {
    // Step 1: one sign-in each from A1 to A4, held in their password checks.
    const running = [1, 2, 3, 4].map((n) => attempt(app, `198.51.100.${n}`, C))
    await vi.waitFor(() => expect(checksStarted).toBe(4))

    // Step 2: A5, refused at once, with no check started for it and no session.
    const refused = await attempt(app, '198.51.100.5', C)
    expect(refused.statusCode).toBe(429)
    expect(refused.json<{ message: string }>().message).toBe(
      'Too many sign-ins at once. Try again.',
    )
    expect(checksStarted).toBe(4)
    expect(await sessionCount(x)).toBe(0)

    // Step 3: once released, each of A1 to A4 signs alice in.
    release()
    for (const answer of await Promise.all(running)) expect(answer.statusCode).toBe(204)

    // Step 4: A6 signs alice in.
    expect((await attempt(app, '198.51.100.6', C)).statusCode).toBe(204)
    expect(await sessionCount(x)).toBe(5)
  })
})

/** A backend started from its configuration, with `env` added, on a fresh test database. */
async function startedBackend(env: Record<string, string>) {
  const x = await createTestDatabase()
  const fx: ConfigFixture = createConfigFixture()
  const backend: Backend = await startBackend({
    env: { COLD_SEANCE_DATABASE_URL: x.url, ...fx.githubEnv, ...env },
    cwd: fx.dir,
    recheckTimer: false,
  })
  await seedAccount(x.db, C)
  return {
    x,
    app: backend.app,
    async stop() {
      await backend.app.close()
      fx.remove()
      await x.drop()
    },
  }
}

const P = '203.0.113.7'
const A = '198.51.100.1'
const B = '198.51.100.2'

describe('TC-291: sign-in attempts through a trusted proxy are counted against the forwarded address', () => {
  let deployment: Awaited<ReturnType<typeof startedBackend>>

  beforeAll(async () => {
    deployment = await startedBackend({ COLD_SEANCE_SERVER_TRUSTED_PROXIES: P })
  })

  afterAll(async () => {
    await deployment?.stop()
  })

  it('refuses A through P after its 10 attempts, and signs B in through P', async () => {
    const { app, x } = deployment
    // Step 1: 10 attempts with W through P, for A.
    for (let i = 0; i < 10; i++) expect((await attempt(app, P, W, A)).statusCode).toBe(401)
    const before = await sessionCount(x)
    // Step 2: A with C through P, refused.
    expect((await attempt(app, P, C, A)).statusCode).toBe(429)
    expect(await sessionCount(x)).toBe(before)
    // Step 3: B with C through P signs alice in.
    expect((await attempt(app, P, C, B)).statusCode).toBe(204)
  })
})

describe('TC-292: without a trusted proxy, sign-in attempts are counted against the address they come from', () => {
  let deployment: Awaited<ReturnType<typeof startedBackend>>

  beforeAll(async () => {
    deployment = await startedBackend({})
  })

  afterAll(async () => {
    await deployment?.stop()
  })

  it('refuses P after 10 attempts, whatever addresses it names in X-Forwarded-For', async () => {
    const { app, x } = deployment
    // Step 1: 10 attempts with W from P, the first five naming A and the others B.
    for (let i = 0; i < 10; i++) {
      expect((await attempt(app, P, W, i < 5 ? A : B)).statusCode).toBe(401)
    }
    const before = await sessionCount(x)
    // Step 2: from P, naming B, with C: refused, since all 10 came from P.
    expect((await attempt(app, P, C, B)).statusCode).toBe(429)
    expect(await sessionCount(x)).toBe(before)
  })
})
