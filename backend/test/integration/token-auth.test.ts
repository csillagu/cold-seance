import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { tokenAuthenticator } from '../../src/api/token-auth.ts'
import { buildApp } from '../../src/app.ts'
import { apiTokens, auditLog } from '../../src/db/schema.ts'
import { createServices } from '../../src/service/services.ts'
import { startBackend } from '../../src/start.ts'
import { seedAccount } from '../helpers/accounts.ts'
import { createConfigFixture } from '../helpers/config.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// Token authentication (SC-055) against a real PostgreSQL: which tokens are recognised, and that a
// request with one acts as its owner, with the owner's current roles, through the REST API channel
// (FR-113, DD-048).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

describe('token authentication', () => {
  let x: TestDatabase
  let services: ReturnType<typeof createServices>
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp({}, { authenticators: [tokenAuthenticator(services.apiTokens)], services })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  const tokenOf = async (owner: Seeded, expiresAt?: Date) =>
    (
      await services.apiTokens.createToken(
        { accountId: owner.id, channel: 'ui' },
        expiresAt ? { expiresAt } : {},
      )
    ).secret
  const withToken = (secret: string, url = '/api/tokens') =>
    app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${secret}` } })

  it("acts as the token's owner: the request reads the owner's own tokens", async () => {
    const owner = await seedAccount(x.db, { username: 'owner' })
    const secret = await tokenOf(owner)
    const response = await withToken(secret)
    expect(response.statusCode).toBe(200)
    expect(response.json().map((t: { id: string }) => t.id)).toEqual(
      (await services.apiTokens.listTokens({ accountId: owner.id, channel: 'ui' })).map(
        (t) => t.id,
      ),
    )
  })

  it('records a change made with a token as made by its owner through the REST API channel', async () => {
    const secret = await tokenOf(alice)
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { authorization: `Bearer ${secret}` },
      payload: { name: 'Apollo' },
    })
    expect(created.statusCode).toBe(201)
    const [entry] = await x.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.projectId, created.json<{ id: string }>().id))
    expect(entry).toMatchObject({ actorAccountId: alice.id, channels: ['rest-api'] })
  })

  it('takes a token only from the Authorization header: not from the query string or another header', async () => {
    const secret = await tokenOf(bob)
    for (const request of [
      { url: `/api/tokens?access_token=${secret}`, headers: {} },
      { url: '/api/tokens', headers: { 'x-api-token': secret } },
      { url: '/api/tokens', headers: { cookie: `token=${secret}` } },
    ]) {
      const response = await app.inject({ method: 'GET', ...request })
      expect(response.statusCode).toBe(401)
    }
  })

  it('tells a refused caller to authenticate with a Bearer token', async () => {
    const response = await withToken('cst_never-created')
    expect(response.statusCode).toBe(401)
    expect(response.headers['www-authenticate']).toBe('Bearer')
  })

  it('takes the scheme in any case and spaces around the token', async () => {
    const secret = await tokenOf(bob)
    const response = await app.inject({
      method: 'GET',
      url: '/api/tokens',
      headers: { authorization: `bearer   ${secret}  ` },
    })
    expect(response.statusCode).toBe(200)
  })

  it('refuses a revoked token at once', async () => {
    const secret = await tokenOf(bob)
    expect((await withToken(secret)).statusCode).toBe(200)
    const tokens = await services.apiTokens.listTokens({ accountId: bob.id, channel: 'ui' })
    for (const token of tokens) {
      await services.apiTokens.revokeToken({ accountId: bob.id, channel: 'ui' }, token.id)
    }
    expect((await withToken(secret)).statusCode).toBe(401)
  })

  it('refuses an expired token, and takes one until it expires', async () => {
    const secret = await tokenOf(bob, new Date(Date.now() + 60_000))
    expect((await withToken(secret)).statusCode).toBe(200)
    await x.db
      .update(apiTokens)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(apiTokens.accountId, bob.id))
    expect((await withToken(secret)).statusCode).toBe(401)
  })

  it.each([
    ['no Authorization header', undefined],
    ['a token that was never created', 'Bearer cst_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'],
    ['a secret that is not a token', 'Bearer something-else'],
    ['another scheme', 'Basic YWxpY2U6cHc='],
    ['a scheme with no token', 'Bearer '],
  ])('refuses a request with %s, as one no authenticator recognises', async (_, authorization) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/tokens',
      headers: authorization === undefined ? {} : { authorization },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json().message).toBe('Authentication required')
  })

  it('answers nothing for a secret without the token prefix', async () => {
    expect(await services.apiTokens.resolve('ghp_not_ours')).toBeUndefined()
  })
})

describe('TC-165: an API token gets its owner’s read-only role', () => {
  let x: TestDatabase
  let services: ReturnType<typeof createServices>
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp({}, { authenticators: [tokenAuthenticator(services.apiTokens)], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  it("lets bob's token read Apollo and refuses it an edit, as bob's read-only role there does", async () => {
    const asAlice = { accountId: alice.id, channel: 'ui' } as const
    const apollo = await services.projects.createProject(asAlice, { name: 'Apollo' })
    await services.projectRoles.setRole(asAlice, apollo.id, bob.id, 'read-only')
    const { secret } = await services.apiTokens.createToken({ accountId: bob.id, channel: 'ui' })
    const headers = { authorization: `Bearer ${secret}` }

    // Step 1: a read succeeds.
    const read = await app.inject({ method: 'GET', url: `/api/projects/${apollo.id}`, headers })
    expect(read.statusCode).toBe(200)
    expect(read.json()).toEqual({ ...apollo, role: 'read-only' })

    // Step 2: an edit is refused; here a change of Apollo's members, the one edit there is yet.
    const edit = await app.inject({
      method: 'PUT',
      url: `/api/projects/${apollo.id}/members/${bob.id}`,
      headers,
      payload: { role: 'admin' },
    })
    expect(edit.statusCode).toBe(403)
    expect(await services.projectRoles.roleOf(bob.id, apollo.id)).toBe('read-only')
  })

  it("follows bob's role as it changes: removed from Apollo, his token no longer sees it", async () => {
    const asAlice = { accountId: alice.id, channel: 'ui' } as const
    const apollo = await services.projects.createProject(asAlice, { name: 'Apollo' })
    await services.projectRoles.setRole(asAlice, apollo.id, bob.id, 'read-only')
    const { secret } = await services.apiTokens.createToken({ accountId: bob.id, channel: 'ui' })
    const read = () =>
      app.inject({
        method: 'GET',
        url: `/api/projects/${apollo.id}`,
        headers: { authorization: `Bearer ${secret}` },
      })
    expect((await read()).statusCode).toBe(200)
    await services.projectRoles.removeMember(asAlice, apollo.id, bob.id)
    const after = await read()
    expect(after.statusCode).toBe(403)
    expect(after.json().error).toBe('Not Visible')
  })

  it("lets bob's token read task T and refuses it renaming T to Mine, which stays Draft", async () => {
    const asAlice = { accountId: alice.id, channel: 'ui' } as const
    const apollo = await services.projects.createProject(asAlice, { name: 'Apollo' })
    await services.projectRoles.setRole(asAlice, apollo.id, bob.id, 'read-only')
    const t = await services.tasks.createTask(asAlice, apollo.id, { title: 'Draft' })
    const { secret } = await services.apiTokens.createToken({ accountId: bob.id, channel: 'ui' })
    const headers = { authorization: `Bearer ${secret}` }

    // Step 1: with bob's token, read T.
    const read = await app.inject({ method: 'GET', url: `/api/tasks/${t.id}`, headers })
    expect(read.statusCode).toBe(200)
    expect(read.json()).toMatchObject({ id: t.id, title: 'Draft' })

    // Step 2: with bob's token, try to change T's title to Mine.
    const edit = await app.inject({
      method: 'PATCH',
      url: `/api/tasks/${t.id}`,
      headers,
      payload: { title: 'Mine' },
    })
    expect(edit.statusCode).toBe(403)

    // Negative: T's title is still Draft.
    expect((await services.tasks.getTask(asAlice, t.id)).title).toBe('Draft')
  })

  // Pending: SC-055 refuses a token whose owner's account is no longer active. The tool has no
  // way yet to end an account, so the token's owner need only exist.
  // TC-166 (MCP server access gets its owner's lack of a role) is in mcp-server.test.ts: the MCP
  // server (SC-027) recognises the same tokens through `ApiTokenService.resolve`.
})

describe('the backend', () => {
  let x: TestDatabase

  beforeEach(async () => {
    x = await createTestDatabase()
  })

  afterEach(async () => {
    await x?.drop()
  })

  it('recognises API tokens on the REST API once started', async () => {
    const fx = createConfigFixture()
    try {
      const backend = await startBackend({
        env: { COLD_SEANCE_DATABASE_URL: x.url, ...fx.githubEnv },
        cwd: fx.dir,
      })
      try {
        const owner = await seedAccount(x.db, { username: 'owner' })
        const { secret } = await createServices(x.db).apiTokens.createToken({
          accountId: owner.id,
          channel: 'ui',
        })
        const response = await backend.app.inject({
          method: 'GET',
          url: '/api/projects',
          headers: { authorization: `Bearer ${secret}` },
        })
        expect(response.statusCode).toBe(200)
        expect((await backend.app.inject({ method: 'GET', url: '/api/projects' })).statusCode).toBe(
          401,
        )
      } finally {
        await backend.app.close()
      }
    } finally {
      fx.remove()
    }
  })
})
