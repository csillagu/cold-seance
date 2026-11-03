import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { accounts, auditLog } from '../../src/db/schema.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { GitHubLinkService } from '../../src/service/github-links.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// The GitHub account link (SC-054) against a real PostgreSQL: its rules, then the test cases of
// FR-135 through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

async function refused(promise: Promise<unknown>, kind: ServiceError['kind']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError)) {
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  }
  expect(error.kind).toBe(kind)
  return error
}

describe('the GitHub account link', () => {
  let x: TestDatabase
  let service: GitHubLinkService
  let root: Seeded
  const fresh = (base: string) => `${base}-${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    x = await createTestDatabase()
    service = new GitHubLinkService(x.db, new AuditLogService(x.db))
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const person = () => seedAccount(x.db, { username: fresh('person') })

  it('lets a person link their own account, and read the link back', async () => {
    const alice = await person()
    expect(await service.linkOf(by(alice), alice.id)).toEqual({
      accountId: alice.id,
      githubLogin: null,
    })
    const login = fresh('tc-alice')
    expect(await service.link(by(alice), alice.id, login)).toEqual({
      accountId: alice.id,
      githubLogin: login,
    })
    expect(await service.linkOf(by(alice), alice.id)).toEqual({
      accountId: alice.id,
      githubLogin: login,
    })
  })

  it("lets a system admin link anyone's account and read it", async () => {
    const alice = await person()
    const login = fresh('tc-alice')
    await service.link(by(root), alice.id, login)
    expect((await service.linkOf(by(root), alice.id)).githubLogin).toBe(login)
  })

  it("refuses someone else's link to anyone but a system admin, before anything else", async () => {
    const [alice, bob] = [await person(), await person()]
    for (const attempt of [
      () => service.link(by(bob), alice.id, fresh('tc-bob')),
      () => service.linkOf(by(bob), alice.id),
      () => service.link(by(bob), randomUUID(), 'not a name'),
    ]) {
      const error = await refused(attempt(), 'forbidden')
      expect(error.message).toBe(
        "Only the person themselves and system admins can link a person's GitHub account",
      )
    }
    expect((await service.linkOf(by(alice), alice.id)).githubLogin).toBeNull()
  })

  it('replaces a link, and records each change in the audit log with the one it replaced', async () => {
    const alice = await person()
    const [first, second] = [fresh('first'), fresh('second')]
    await service.link(by(alice), alice.id, first)
    await service.link(by(root), alice.id, second)
    const entries = await x.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.subjectId, alice.id))
      .orderBy(auditLog.id)
    expect(entries.map((e) => [e.action, e.actorAccountId, e.details])).toEqual([
      ['account.github-linked', alice.id, { githubLogin: first, previous: null }],
      ['account.github-linked', root.id, { githubLogin: second, previous: first }],
    ])
  })

  it('changes nothing and records nothing when linking the account it is linked to already', async () => {
    const alice = await person()
    const login = fresh('same')
    await service.link(by(alice), alice.id, login)
    await service.link(by(alice), alice.id, `  ${login}  `)
    const entries = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, alice.id))
    expect(entries).toHaveLength(1)
  })

  it('refuses a GitHub account another account is linked to, whatever its case', async () => {
    const [alice, bob] = [await person(), await person()]
    const login = fresh('Shared')
    await service.link(by(alice), alice.id, login)
    const error = await refused(service.link(by(bob), bob.id, login.toUpperCase()), 'conflict')
    expect(error.message).toBe(
      `The GitHub account ${login.toUpperCase()} is already linked to another account`,
    )
    expect((await service.linkOf(by(bob), bob.id)).githubLogin).toBeNull()
  })

  it.each([
    ['an empty name', ''],
    ['a name with a space', 'tc alice'],
    ['a name starting with a hyphen', '-alice'],
    ['a name ending with a hyphen', 'alice-'],
    ['a name with two hyphens in a row', 'tc--alice'],
    ['a name of 40 characters', 'a'.repeat(40)],
    ['a name with other characters', 'tc_alice'],
  ])('refuses %s', async (_, login) => {
    const alice = await person()
    const error = await refused(service.link(by(alice), alice.id, login), 'invalid')
    expect(error.message).toMatch(/^A GitHub account name has at most 39/)
  })

  it('takes a name of 39 characters, and single hyphens inside', async () => {
    const alice = await person()
    const login = `a-${'b'.repeat(35)}-c`
    expect(login).toHaveLength(39)
    expect((await service.link(by(alice), alice.id, login)).githubLogin).toBe(login)
  })

  it('answers an account that does not exist as not found, to a system admin', async () => {
    for (const attempt of [
      () => service.link(by(root), randomUUID(), 'tc-nobody'),
      () => service.linkOf(by(root), randomUUID()),
      () => service.linkOf(by(root), 'nobody'),
    ]) {
      const error = await refused(attempt(), 'not-found')
      expect(error.message).toBe('There is no such account')
    }
  })

  it('refuses a caller id that is not an account’s', async () => {
    const error = await refused(
      service.linkOf({ accountId: 'nobody', channel: 'ui' }, 'nobody'),
      'forbidden',
    )
    expect(error.message).toMatch(/^Only the person themselves and system admins/)
  })
})

describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Seeded
  let alice: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const link = (who: Seeded, of: Seeded, githubLogin: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/accounts/${of.id}/github`,
      headers: as(who),
      payload: { githubLogin },
    })
  const read = (who: Seeded, of: Seeded) =>
    app.inject({ method: 'GET', url: `/api/accounts/${of.id}/github`, headers: as(who) })

  const linkedTo = async (login: string) =>
    (await x.db.select().from(accounts))
      .filter((a) => a.githubLogin === login)
      .map((a) => a.username)

  describe('TC-199: a person links their own GitHub account', () => {
    it('links alice to tc-alice, and to no other account', async () => {
      expect((await link(alice, alice, 'tc-alice')).statusCode).toBe(200)
      const response = await read(alice, alice)
      expect(response.statusCode).toBe(200)
      expect(response.json()).toEqual({ accountId: alice.id, githubLogin: 'tc-alice' })
      expect(await linkedTo('tc-alice')).toEqual(['alice'])
    })

    // Not tested: that the tester can sign in to GitHub as tc-alice. The link is given by name
    // alone (SRC-202), so nothing here signs in to GitHub.
  })

  describe("TC-200: a system admin links a person's GitHub account", () => {
    it("links alice to tc-alice as root, and leaves root's own account unlinked", async () => {
      expect((await link(root, alice, 'tc-alice')).statusCode).toBe(200)
      expect((await read(alice, alice)).json()).toEqual({
        accountId: alice.id,
        githubLogin: 'tc-alice',
      })
      expect((await read(root, root)).json()).toEqual({ accountId: root.id, githubLogin: null })
    })
  })

  it('answers the routes’ refusals: 403 for someone else, 409 for a taken name, 400 for a bad one', async () => {
    const bob = await seedAccount(x.db, { username: 'bob' })
    expect((await link(bob, alice, 'tc-bob')).statusCode).toBe(403)
    expect((await read(bob, alice)).statusCode).toBe(403)
    await link(alice, alice, 'tc-alice')
    expect((await link(bob, bob, 'tc-alice')).statusCode).toBe(409)
    expect((await link(bob, bob, 'tc bob')).statusCode).toBe(400)
    const badId = await app.inject({
      method: 'GET',
      url: '/api/accounts/bob/github',
      headers: as(bob),
    })
    expect(badId.statusCode).toBe(400)
  })
})
