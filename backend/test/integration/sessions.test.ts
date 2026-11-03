import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { sessions } from '../../src/db/schema.ts'
import { hashSecret } from '../../src/service/api-tokens.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { SessionService, SIGN_IN_REFUSED } from '../../src/service/sessions.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// Sign-in (SC-052) against a real PostgreSQL: the rules of the session service, then the backend's
// part of FR-118's test case through the REST API.

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

describe('TC-177: a person signs in with an account held in the tool', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Awaited<ReturnType<typeof seedAccount>>

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
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
    const sessionId = /^session=([A-Za-z0-9_-]+);/.exec(cookie)?.[1]
    expect(sessionId).toBeDefined()
    const [session] = await x.db
      .select()
      .from(sessions)
      .where(eq(sessions.secretHash, hashSecret(sessionId!)))
    expect(session?.accountId).toBe(alice.id)

    // Step 2: W is refused, and no session is created.
    const refusedSignIn = await signIn('alice', 'W-wrong-horse')
    expect(refusedSignIn.statusCode).toBe(401)
    expect(refusedSignIn.json().message).toBe(SIGN_IN_REFUSED)
    expect(refusedSignIn.headers['set-cookie']).toBeUndefined()
    expect(await x.db.select().from(sessions)).toHaveLength(1)
  })

  // Pending: TC-177 in full: alice signs in and out on the sign-in page (SC-075), signing out
  // ending the session (SC-107), and the page offering no outside identity provider.
})
