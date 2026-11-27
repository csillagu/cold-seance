import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sessionAuthenticator } from '../../src/api/session-auth.ts'
import { tokenAuthenticator } from '../../src/api/token-auth.ts'
import { buildApp } from '../../src/app.ts'
import { apiTokens, auditLog, sessions } from '../../src/db/schema.ts'
import { hashSecret } from '../../src/service/api-tokens.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { SessionService, SIGN_IN_REFUSED, SIGN_OUT_NOT_YOURS } from '../../src/service/sessions.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { startBackend } from '../../src/start.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// Sign-in (SC-052) and the session check (SC-107) against a real PostgreSQL: the rules of the
// session service, the session cookie acting as its person through the REST API, then the
// backend's part of FR-118's test case.

async function refused(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError)) {
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  }
  expect(error.kind).toBe('unauthenticated')
  expect(error.message).toBe(SIGN_IN_REFUSED)
  return error
}

describe('the session service', () => {
  let x: TestDatabase
  let service: SessionService
  let alice: Awaited<ReturnType<typeof seedAccount>>

  beforeAll(async () => {
    x = await createTestDatabase()
    service = new SessionService(x.db)
    alice = await seedAccount(x.db, { username: 'alice', password: 'alice-C' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const sessionsOf = (accountId: string) =>
    x.db.select().from(sessions).where(eq(sessions.accountId, accountId))

  it('signs in with the right password, creating a session kept only as its hash', async () => {
    const before = (await sessionsOf(alice.id)).length
    const signedIn = await service.signIn({ username: 'alice', password: 'alice-C' })
    expect(signedIn.accountId).toBe(alice.id)
    // 32 random bytes in unpadded base64url.
    expect(signedIn.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const rows = await sessionsOf(alice.id)
    expect(rows).toHaveLength(before + 1)
    expect(rows.map((r) => r.secretHash)).toContain(hashSecret(signedIn.sessionId))
    expect(JSON.stringify(rows)).not.toContain(signedIn.sessionId)
  })

  it('gives each sign-in a session of its own', async () => {
    const first = await service.signIn({ username: 'alice', password: 'alice-C' })
    const second = await service.signIn({ username: 'alice', password: 'alice-C' })
    expect(first.sessionId).not.toBe(second.sessionId)
  })

  it('finds the account whatever the case of the username, and around spaces', async () => {
    const signedIn = await service.signIn({ username: '  ALICE ', password: 'alice-C' })
    expect(signedIn.accountId).toBe(alice.id)
  })

  it('finds a username whose capitals PostgreSQL and JavaScript lower differently', async () => {
    // JavaScript lowers İ to i and a combining dot; PostgreSQL, as the unique index does, to i.
    const ipek = await seedAccount(x.db, { username: 'İpek', password: 'ipek-pw' })
    expect((await service.signIn({ username: 'İpek', password: 'ipek-pw' })).accountId).toBe(
      ipek.id,
    )
  })

  it('refuses a wrong password and creates no session', async () => {
    const before = (await sessionsOf(alice.id)).length
    for (const password of ['alice-W', 'ALICE-C', '', 'alice-C ']) {
      await refused(service.signIn({ username: 'alice', password }))
    }
    expect(await sessionsOf(alice.id)).toHaveLength(before)
  })

  it('refuses a username with no account the same way, without telling which was wrong', async () => {
    const all = (await x.db.select().from(sessions)).length
    await refused(service.signIn({ username: 'mallory', password: 'alice-C' }))
    await refused(service.signIn({ username: '', password: '' }))
    expect(await x.db.select().from(sessions)).toHaveLength(all)
  })
})

describe('the session service: looking up and ending sessions (SC-107)', () => {
  let x: TestDatabase
  let service: SessionService
  let alice: Awaited<ReturnType<typeof seedAccount>>
  let bob: Awaited<ReturnType<typeof seedAccount>>

  beforeAll(async () => {
    x = await createTestDatabase()
    service = new SessionService(x.db)
    alice = await seedAccount(x.db, { username: 'alice', password: 'alice-C' })
    bob = await seedAccount(x.db, { username: 'bob', password: 'bob-C' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const signIn = (who: 'alice' | 'bob') =>
    service.signIn({ username: who, password: `${who}-C` }).then((s) => s.sessionId)
  const asCaller = (account: { id: string }) => ({ accountId: account.id, channel: 'ui' as const })

  it("finds a live session's person by the id the cookie holds", async () => {
    expect(await service.resolve(await signIn('alice'))).toBe(alice.id)
    expect(await service.resolve(await signIn('bob'))).toBe(bob.id)
  })

  it('finds nobody for an id that no session has', async () => {
    expect(await service.resolve('never-created')).toBeUndefined()
    expect(await service.resolve('')).toBeUndefined()
  })

  it('does not take the hash the database keeps for the id itself', async () => {
    const id = await signIn('alice')
    expect(await service.resolve(hashSecret(id))).toBeUndefined()
  })

  it('deletes the session on signing out, at once, and only that one', async () => {
    const ending = await signIn('alice')
    const other = await signIn('alice')
    await service.signOut(asCaller(alice), ending)
    expect(await service.resolve(ending)).toBeUndefined()
    expect(
      await x.db
        .select()
        .from(sessions)
        .where(eq(sessions.secretHash, hashSecret(ending))),
    ).toEqual([])
    // Her other browser stays signed in.
    expect(await service.resolve(other)).toBe(alice.id)
  })

  it("refuses to end someone else's session, which stays live", async () => {
    const bobs = await signIn('bob')
    const error = await service.signOut(asCaller(alice), bobs).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ServiceError)
    expect(error).toMatchObject({ kind: 'forbidden', message: SIGN_OUT_NOT_YOURS })
    expect(await service.resolve(bobs)).toBe(bob.id)
  })

  it('signs out of a session that no longer exists without complaint', async () => {
    const id = await signIn('alice')
    await service.signOut(asCaller(alice), id)
    await expect(service.signOut(asCaller(alice), id)).resolves.toBeUndefined()
    await expect(service.signOut(asCaller(alice), 'never-created')).resolves.toBeUndefined()
  })
})

describe('the session check on requests from the browser (SC-107)', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let alice: Awaited<ReturnType<typeof seedAccount>>

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp(
      {},
      {
        authenticators: [
          tokenAuthenticator(services.apiTokens),
          sessionAuthenticator(services.sessions),
        ],
        services,
      },
    )
    alice = await seedAccount(x.db, { username: 'alice', password: 'alice-C' })
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  // Each sign-in from an address of its own: the app is shared by these tests, which sign in more
  // often than one address may within a minute (SC-132).
  let addresses = 0
  const nextAddress = () => `192.0.2.${++addresses}`

  /** Signs alice in through the REST API and answers the cookie the browser would send back. */
  async function signedInCookie(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      remoteAddress: nextAddress(),
      payload: { username: 'alice', password: 'alice-C' },
    })
    expect(response.statusCode).toBe(204)
    return String(response.headers['set-cookie']).split(';')[0]!
  }
  const listTokens = (headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url: '/api/tokens', headers })
  const signOut = (cookie: string) =>
    app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } })

  it("acts as the live session's person: the request reads her own tokens", async () => {
    const { token } = await services.apiTokens.createToken({ accountId: alice.id, channel: 'ui' })
    const response = await listTokens({ cookie: await signedInCookie() })
    expect(response.statusCode).toBe(200)
    expect(response.json().map((t: { id: string }) => t.id)).toContain(token.id)
  })

  it('records a change made with the session as made by its person through the UI', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: await signedInCookie() },
      payload: {},
    })
    expect(response.statusCode).toBe(201)
    const id = response.json<{ token: { id: string } }>().token.id
    const [stored] = await x.db.select().from(apiTokens).where(eq(apiTokens.id, id))
    expect(stored?.accountId).toBe(alice.id)
    const [entry] = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, id))
    expect(entry).toMatchObject({ actorAccountId: alice.id, channels: ['ui'] })
  })

  it('refuses a request without a cookie', async () => {
    const response = await listTokens()
    expect(response.statusCode).toBe(401)
  })

  it.each([
    ['an id no session has', '__Host-session=never-created'],
    ['an empty session cookie', '__Host-session='],
    ['only other cookies', 'theme=dark'],
  ])('refuses a request whose cookie holds %s', async (_, cookie) => {
    expect((await listTokens({ cookie })).statusCode).toBe(401)
  })

  it('does not take a live session id under a cookie name without the __Host- prefix', async () => {
    const id = (await signedInCookie()).slice('__Host-session='.length)
    expect((await listTokens({ cookie: `session=${id}` })).statusCode).toBe(401)
  })

  it('signs out: the session is deleted, the cookie cleared, and the cookie refused after', async () => {
    const cookie = await signedInCookie()
    const id = cookie.slice('__Host-session='.length)
    expect((await listTokens({ cookie })).statusCode).toBe(200)

    const out = await signOut(cookie)
    expect(out.statusCode).toBe(204)
    expect(String(out.headers['set-cookie'])).toMatch(/^__Host-session=; .*Max-Age=0/)
    expect(
      await x.db
        .select()
        .from(sessions)
        .where(eq(sessions.secretHash, hashSecret(id))),
    ).toEqual([])

    expect((await listTokens({ cookie })).statusCode).toBe(401)
    // Signing out again with the dead cookie is refused like any other request with it.
    expect((await signOut(cookie)).statusCode).toBe(401)
  })

  it('leaves her other sessions signed in when she signs out of one', async () => {
    const here = await signedInCookie()
    const there = await signedInCookie()
    expect((await signOut(here)).statusCode).toBe(204)
    expect((await listTokens({ cookie: there })).statusCode).toBe(200)
  })

  it('refuses a token that does not work even beside a live session cookie', async () => {
    const response = await listTokens({
      cookie: await signedInCookie(),
      authorization: 'Bearer cst_revoked',
    })
    expect(response.statusCode).toBe(401)
  })

  it("refuses to sign out of a session that is not the caller's, leaving it live and its cookie set", async () => {
    const alicesCookie = await signedInCookie()
    const bob = await seedAccount(x.db, { username: 'bob' })
    const { secret } = await services.apiTokens.createToken({ accountId: bob.id, channel: 'ui' })
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { cookie: alicesCookie, authorization: `Bearer ${secret}` },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().message).toBe(SIGN_OUT_NOT_YOURS)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect((await listTokens({ cookie: alicesCookie })).statusCode).toBe(200)
  })

  it('signs out of her own session with her own token beside the cookie', async () => {
    const cookie = await signedInCookie()
    const { secret } = await services.apiTokens.createToken({ accountId: alice.id, channel: 'ui' })
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { cookie, authorization: `Bearer ${secret}` },
    })
    expect(response.statusCode).toBe(204)
    expect((await listTokens({ cookie })).statusCode).toBe(401)
  })

  it('signs in again with a cookie of a signed-out session in the request', async () => {
    const dead = await signedInCookie()
    await signOut(dead)
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      remoteAddress: nextAddress(),
      headers: { cookie: dead },
      payload: { username: 'alice', password: 'alice-C' },
    })
    expect(response.statusCode).toBe(204)
  })
})

describe('the session check once the backend has started', () => {
  let x: TestDatabase

  beforeAll(async () => {
    x = await createTestDatabase()
  })

  afterAll(async () => {
    await x?.drop()
  })

  it('recognises the session cookie on the REST API, beside API tokens', async () => {
    const fx = createConfigFixture()
    try {
      const backend = await startBackend({
        env: { COLD_SEANCE_DATABASE_URL: x.url, ...fx.githubEnv },
        cwd: fx.dir,
      })
      try {
        await seedAccount(x.db, { username: 'alice', password: 'alice-C' })
        const signedIn = await backend.app.inject({
          method: 'POST',
          url: '/api/session',
          payload: { username: 'alice', password: 'alice-C' },
        })
        const cookie = String(signedIn.headers['set-cookie']).split(';')[0]!
        const read = () =>
          backend.app.inject({ method: 'GET', url: '/api/projects', headers: { cookie } })
        expect((await read()).statusCode).toBe(200)
        await backend.app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } })
        expect((await read()).statusCode).toBe(401)
      } finally {
        await backend.app.close()
      }
    } finally {
      fx.remove()
    }
  })
})

describe('TC-177: a person signs in with an account held in the tool', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Awaited<ReturnType<typeof seedAccount>>

  beforeEach(async () => {
    x = await createTestDatabase()
    const services = createServices(x.db)
    // The session check (SC-107) beside the test authenticator, which stands in for root's own
    // browser.
    app = buildApp(
      {},
      { authenticators: [testAuthenticator, sessionAuthenticator(services.sessions)], services },
    )
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const signIn = (username: string, password: string) =>
    app.inject({ method: 'POST', url: '/api/session', payload: { username, password } })

  it('signs alice in with the credentials root gave her, and refuses wrong ones', async () => {
    // root creates alice with credentials C.
    const created = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: as(root),
      payload: { username: 'alice', password: 'C-correct-horse' },
    })
    expect(created.statusCode).toBe(201)
    const alice = created.json<{ id: string }>()

    // Step 1: C signs alice in: a session, and its id in the cookie.
    const signedIn = await signIn('alice', 'C-correct-horse')
    expect(signedIn.statusCode).toBe(204)
    const cookie = String(signedIn.headers['set-cookie'])
    const sessionId = /^__Host-session=([A-Za-z0-9_-]+);/.exec(cookie)?.[1]
    expect(sessionId).toBeDefined()
    const [session] = await x.db
      .select()
      .from(sessions)
      .where(eq(sessions.secretHash, hashSecret(sessionId!)))
    expect(session?.accountId).toBe(alice.id)
    const cookieHeader = `__Host-session=${sessionId!}`
    const acting = await app.inject({
      method: 'GET',
      url: '/api/tokens',
      headers: { cookie: cookieHeader },
    })
    expect(acting.statusCode).toBe(200)

    // Step 2: alice signs out, which deletes her session...
    const signedOut = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { cookie: cookieHeader },
    })
    expect(signedOut.statusCode).toBe(204)
    expect(await x.db.select().from(sessions)).toEqual([])
    expect(
      (await app.inject({ method: 'GET', url: '/api/tokens', headers: { cookie: cookieHeader } }))
        .statusCode,
    ).toBe(401)

    // ...and W is refused, and no session is created.
    const refusedSignIn = await signIn('alice', 'W-wrong-horse')
    expect(refusedSignIn.statusCode).toBe(401)
    expect(refusedSignIn.json().message).toBe(SIGN_IN_REFUSED)
    expect(refusedSignIn.headers['set-cookie']).toBeUndefined()
    expect(await x.db.select().from(sessions)).toEqual([])
  })

  // The browser steps, alice signing in and out on the sign-in page (SC-075), and the page
  // offering no outside identity provider, are in e2e/tests/sign-in.spec.ts.
})
