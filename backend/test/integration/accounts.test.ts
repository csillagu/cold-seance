import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  AccountService,
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
} from '../../src/service/accounts.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, storedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { argon2idMatches } from '../helpers/passwords.ts'

// Account administration (SC-015) against a real PostgreSQL: the rules of the account service,
// then the test cases of FR-117 and FR-140 through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

/** The caller that is the given account. */
const by = (account: Seeded) => ({ accountId: account.id })

/** Expects `promise` to be refused by the service layer with the given kind of error. */
async function refused(promise: Promise<unknown>, kind: ServiceError['kind']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError))
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  expect(error.kind).toBe(kind)
  return error
}

describe('the account service', () => {
  let x: TestDatabase
  let service: AccountService
  let root: Seeded
  let alice: Seeded
  let n = 0
  /** A username no other test has used, since these tests share one database. */
  const fresh = (base: string) => `${base}-${++n}`

  beforeAll(async () => {
    x = await createTestDatabase()
    service = new AccountService(x.db)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  describe('createAccount', () => {
    it('lets a system admin create an account, which is not a system admin', async () => {
      const username = fresh('erin')
      const created = await service.createAccount(by(root), { username, password: 'erin-pw' })
      expect(created).toEqual({ id: expect.any(String), username, systemAdmin: false })
      expect(created).not.toHaveProperty('passwordHash')
      const stored = await storedAccount(x.db, username)
      expect(stored).toMatchObject({ id: created.id, username, systemAdmin: false })
    })

    it('stores the password only as its Argon2id hash (DD-056)', async () => {
      const username = fresh('erin')
      await service.createAccount(by(root), { username, password: 'erin-pw' })
      const stored = await storedAccount(x.db, username)
      expect(stored?.passwordHash).not.toContain('erin-pw')
      expect(stored?.passwordHash).toMatch(/^\$argon2id\$/)
      expect(argon2idMatches(stored!.passwordHash, 'erin-pw')).toBe(true)
    })

    it('refuses someone who is not a system admin, and creates nothing', async () => {
      const username = fresh('erin')
      const error = await refused(
        service.createAccount(by(alice), { username, password: 'pw' }),
        'forbidden',
      )
      expect(error.message).toBe('Only system admins can administer accounts')
      expect(await storedAccount(x.db, username)).toBeUndefined()
    })

    it('refuses a caller with no account, or with an id that is no account id', async () => {
      const username = fresh('erin')
      for (const accountId of ['00000000-0000-4000-8000-000000000000', 'root', '']) {
        await refused(
          service.createAccount({ accountId }, { username, password: 'pw' }),
          'forbidden',
        )
      }
      expect(await storedAccount(x.db, username)).toBeUndefined()
    })

    it('refuses someone who is not a system admin before looking at what they sent', async () => {
      // A system admin would be told the username is missing, or taken; alice learns neither.
      await expect(
        service.createAccount(by(alice), { username: '', password: '' }),
      ).rejects.toMatchObject({ kind: 'forbidden' })
      await expect(
        service.createAccount(by(alice), { username: 'root', password: 'pw' }),
      ).rejects.toMatchObject({ kind: 'forbidden' })
    })

    it('trims the username', async () => {
      const username = fresh('erin')
      const created = await service.createAccount(by(root), {
        username: `  ${username}\t`,
        password: 'pw',
      })
      expect(created.username).toBe(username)
    })

    it.each([
      ['empty', ''],
      ['only whitespace', ' \t '],
    ])('refuses a username that is %s', async (_, username) => {
      const error = await refused(
        service.createAccount(by(root), { username, password: 'pw' }),
        'invalid',
      )
      expect(error.message).toBe('A username is required')
    })

    it(`takes a username of ${USERNAME_MAX_LENGTH} characters and refuses a longer one`, async () => {
      const longest = fresh('u').padEnd(USERNAME_MAX_LENGTH, 'x')
      await expect(
        service.createAccount(by(root), { username: longest, password: 'pw' }),
      ).resolves.toMatchObject({
        username: longest,
      })
      const error = await refused(
        service.createAccount(by(root), { username: `${longest}y`, password: 'pw' }),
        'invalid',
      )
      expect(error.message).toBe(`A username can have at most ${USERNAME_MAX_LENGTH} characters`)
    })

    it('refuses an empty password', async () => {
      const username = fresh('erin')
      const error = await refused(
        service.createAccount(by(root), { username, password: '' }),
        'invalid',
      )
      expect(error.message).toBe('A password is required')
      expect(await storedAccount(x.db, username)).toBeUndefined()
    })

    it(`takes a password of ${PASSWORD_MAX_LENGTH} characters and refuses a longer one`, async () => {
      const longest = 'p'.repeat(PASSWORD_MAX_LENGTH)
      const username = fresh('erin')
      await service.createAccount(by(root), { username, password: longest })
      expect(argon2idMatches((await storedAccount(x.db, username))!.passwordHash, longest)).toBe(
        true,
      )
      const error = await refused(
        service.createAccount(by(root), { username: fresh('erin'), password: `${longest}p` }),
        'invalid',
      )
      expect(error.message).toBe(`A password can have at most ${PASSWORD_MAX_LENGTH} characters`)
    })

    it('refuses a username that is taken, in any case', async () => {
      const username = fresh('erin')
      await service.createAccount(by(root), { username, password: 'pw' })
      for (const taken of [username, username.toUpperCase(), ` ${username} `]) {
        const error = await refused(
          service.createAccount(by(root), { username: taken, password: 'pw' }),
          'conflict',
        )
        expect(error.message).toBe(`The username ${taken.trim()} is already taken`)
      }
    })

    it('lets only one of two simultaneous requests for the same username succeed', async () => {
      const username = fresh('erin')
      const results = await Promise.allSettled([
        service.createAccount(by(root), { username, password: 'one' }),
        service.createAccount(by(root), { username: username.toUpperCase(), password: 'two' }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const [rejected] = results.filter((r) => r.status === 'rejected')
      expect(rejected?.reason).toBeInstanceOf(ServiceError)
      expect(rejected?.reason).toMatchObject({ kind: 'conflict' })
    })
  })

  describe('makeSystemAdmin', () => {
    it('lets a system admin make another person a system admin, and stays one', async () => {
      const bob = await seedAccount(x.db, { username: fresh('bob') })
      const made = await service.makeSystemAdmin(by(root), bob.id)
      expect(made).toEqual({ id: bob.id, username: bob.username, systemAdmin: true })
      expect((await storedAccount(x.db, bob.username))?.systemAdmin).toBe(true)
      expect((await storedAccount(x.db, 'root'))?.systemAdmin).toBe(true)
    })

    it('gives the new system admin the same powers: they can make others system admins', async () => {
      const bob = await seedAccount(x.db, { username: fresh('bob') })
      const carol = await seedAccount(x.db, { username: fresh('carol') })
      await service.makeSystemAdmin(by(root), bob.id)
      await expect(service.makeSystemAdmin(by(bob), carol.id)).resolves.toMatchObject({
        systemAdmin: true,
      })
    })

    it('changes nothing, and succeeds, for someone who already is a system admin', async () => {
      const bob = await seedAccount(x.db, { username: fresh('bob'), systemAdmin: true })
      await expect(service.makeSystemAdmin(by(root), bob.id)).resolves.toMatchObject({
        systemAdmin: true,
      })
      await expect(service.makeSystemAdmin(by(root), root.id)).resolves.toMatchObject({
        systemAdmin: true,
      })
    })

    it('refuses someone who is not a system admin, and changes nothing', async () => {
      const bob = await seedAccount(x.db, { username: fresh('bob') })
      await refused(service.makeSystemAdmin(by(alice), bob.id), 'forbidden')
      await refused(service.makeSystemAdmin(by(alice), alice.id), 'forbidden')
      expect((await storedAccount(x.db, bob.username))?.systemAdmin).toBe(false)
      expect((await storedAccount(x.db, 'alice'))?.systemAdmin).toBe(false)
    })

    it('refuses someone who is not a system admin before looking for the account', async () => {
      // A system admin would be told there is no such account; alice is not.
      await expect(
        service.makeSystemAdmin(by(alice), '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({ kind: 'forbidden' })
    })

    it.each([
      ['no account has', '00000000-0000-4000-8000-000000000000'],
      ['is no account id at all', 'alice'],
    ])('answers not found for an id that %s', async (_, accountId) => {
      const error = await refused(service.makeSystemAdmin(by(root), accountId), 'not-found')
      expect(error.message).toBe('There is no such account')
    })
  })

  describe('listAccounts', () => {
    it('lists every account by username, without password hashes, to a system admin', async () => {
      const list = await service.listAccounts(by(root))
      expect(list.map((a) => a.username)).toEqual(list.map((a) => a.username).toSorted())
      expect(list).toContainEqual({ id: alice.id, username: 'alice', systemAdmin: false })
      expect(list).toContainEqual({ id: root.id, username: 'root', systemAdmin: true })
      for (const account of list)
        expect(Object.keys(account).toSorted()).toEqual(['id', 'systemAdmin', 'username'])
    })

    it('refuses someone who is not a system admin', async () => {
      await expect(service.listAccounts(by(alice))).rejects.toMatchObject({
        kind: 'forbidden',
        message: 'Only system admins can administer accounts',
      })
    })
  })
})

// The test cases, each on a fresh test deployment: an empty, migrated database, with the first
// system admin `root`. They go through the REST API, as the TCs say. Sign-in (SC-052, SC-107)
// does not exist yet, so the test authenticator says who makes each request; the steps that sign
// in or look at the browser are pending (see each test).
describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const createErin = (headers: Record<string, string>) =>
    app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers,
      payload: { username: 'erin', password: 'erin-password' },
    })

  // Pending: "Sign in as erin" needs sign-in (SC-052). Until then the test checks what sign-in
  // will check: that erin's account holds the Argon2id hash of the password root gave.
  it('TC-174: a system admin creates an account', async () => {
    const response = await createErin(as(root))
    expect(response.statusCode).toBe(201)
    const erin = response.json<{ id: string; username: string; systemAdmin: boolean }>()
    expect(erin).toMatchObject({ username: 'erin' })

    const stored = await storedAccount(x.db, 'erin')
    expect(stored?.id).toBe(erin.id)
    expect(argon2idMatches(stored!.passwordHash, 'erin-password')).toBe(true)

    // Negative assertion: erin is not a system admin.
    expect(erin.systemAdmin).toBe(false)
    expect((await createErin(as(erin))).statusCode).toBe(403)
  })

  // Pending: `alice` being an admin of project `Apollo` needs projects and roles (SC-014, SC-017);
  // the browser offering her no way to create accounts is the account screen's (SC-076); and the
  // failed sign-in as erin needs sign-in (SC-052). Until then "no account erin exists" is checked
  // in the database and in root's list.
  it('TC-175: someone who is not a system admin cannot create an account', async () => {
    const alice = await seedAccount(x.db, { username: 'alice' })
    const response = await createErin(as(alice))
    expect(response.statusCode).toBe(403)

    expect(await storedAccount(x.db, 'erin')).toBeUndefined()
    const list = await app.inject({ method: 'GET', url: '/api/accounts', headers: as(root) })
    expect(list.json<{ username: string }[]>().map((a) => a.username)).not.toContain('erin')
  })

  // Pending: "the sign-in page offers no registration" is the sign-in page's (SC-075).
  it('TC-176: there is no self-registration', async () => {
    const response = await createErin({})
    expect(response.statusCode).toBe(401)

    expect(await storedAccount(x.db, 'erin')).toBeUndefined()
    // Nor can anyone without a session read the accounts, or make themselves a system admin.
    expect((await app.inject({ method: 'GET', url: '/api/accounts' })).statusCode).toBe(401)
    const promote = await app.inject({
      method: 'POST',
      url: '/api/accounts/system-admins',
      payload: { accountId: root.id },
    })
    expect(promote.statusCode).toBe(401)
  })

  it('TC-207: a system admin makes another person a system admin', async () => {
    const alice = await seedAccount(x.db, { username: 'alice' })
    const made = await app.inject({
      method: 'POST',
      url: '/api/accounts/system-admins',
      headers: as(root),
      payload: { accountId: alice.id },
    })
    expect(made.statusCode).toBe(200)
    expect(made.json()).toEqual({ id: alice.id, username: 'alice', systemAdmin: true })

    const response = await createErin(as(alice))
    expect(response.statusCode).toBe(201)
    expect(await storedAccount(x.db, 'erin')).toBeDefined()

    // Negative assertion: root is still a system admin.
    const list = await app.inject({ method: 'GET', url: '/api/accounts', headers: as(root) })
    expect(list.statusCode).toBe(200)
    expect(list.json()).toContainEqual({ id: root.id, username: 'root', systemAdmin: true })
  })
})
