import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { apiTokens, auditLog } from '../../src/db/schema.ts'
import { ApiTokenService, hashSecret, TOKEN_PREFIX } from '../../src/service/api-tokens.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// Personal access token management (SC-016) against a real PostgreSQL. SC-016 delivers no FR of
// its own, so it has no test case; its rules come from DD-048: a random secret shown once, stored
// only as a hash, an optional expiry date, and each person creating, listing and revoking their own
// tokens. Using a token to make a request is SC-055.

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

const NOW = new Date('2027-03-01T09:30:00.000Z')

describe('the token service', () => {
  let x: TestDatabase
  let service: ApiTokenService
  let alice: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    service = new ApiTokenService(x.db, new AuditLogService(x.db), () => NOW)
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const storedRows = (accountId: string) =>
    x.db.select().from(apiTokens).where(eq(apiTokens.accountId, accountId))

  describe('createToken', () => {
    it('creates a token with a random secret, kept only as its hash', async () => {
      const owner = await seedAccount(x.db, { username: `owner-${randomUUID()}` })
      const { token, secret } = await service.createToken(by(owner))
      expect(token).toEqual({
        id: expect.any(String),
        createdAt: expect.any(Date),
        expiresAt: null,
      })
      expect(secret.startsWith(TOKEN_PREFIX)).toBe(true)
      // 32 random bytes in unpadded base64url.
      expect(secret.slice(TOKEN_PREFIX.length)).toMatch(/^[A-Za-z0-9_-]{43}$/)

      const [row] = await storedRows(owner.id)
      expect(row?.secretHash).toBe(hashSecret(secret))
      expect(JSON.stringify(row)).not.toContain(secret.slice(TOKEN_PREFIX.length))
    })

    it('gives each token a different secret', async () => {
      const secrets = new Set<string>()
      for (let i = 0; i < 5; i++) secrets.add((await service.createToken(by(alice))).secret)
      expect(secrets.size).toBe(5)
    })

    it('keeps the expiry date it is given', async () => {
      const expiresAt = new Date('2027-04-01T00:00:00.000Z')
      const { token } = await service.createToken(by(alice), { expiresAt })
      expect(token.expiresAt).toEqual(expiresAt)
      const listed = await service.listTokens(by(alice))
      expect(listed.find((t) => t.id === token.id)?.expiresAt).toEqual(expiresAt)
    })

    it.each([
      ['now', NOW, 'The expiry date must be in the future'],
      [
        'in the past',
        new Date('2027-02-28T00:00:00.000Z'),
        'The expiry date must be in the future',
      ],
      ['not a date', new Date('not a date'), 'The expiry date is not a valid date'],
    ])('refuses an expiry date %s and creates nothing', async (_, expiresAt, message) => {
      const owner = await seedAccount(x.db, { username: `owner-${randomUUID()}` })
      const error = await refused(service.createToken(by(owner), { expiresAt }), 'invalid')
      expect(error.message).toBe(message)
      expect(await storedRows(owner.id)).toEqual([])
    })

    it('records the creation in the audit log, without the secret or its hash', async () => {
      const owner = await seedAccount(x.db, { username: `owner-${randomUUID()}` })
      const { token, secret } = await service.createToken(by(owner))
      const entries = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, token.id))
      expect(entries.map((e) => [e.action, e.actorAccountId, e.subjectType, e.details])).toEqual([
        ['api-token.created', owner.id, 'api-token', { expiresAt: null }],
      ])
      expect(JSON.stringify(entries)).not.toContain(secret)
      expect(JSON.stringify(entries)).not.toContain(hashSecret(secret))
    })

    it('creates nothing when the audit log cannot be written', async () => {
      class UnavailableAuditLog extends AuditLogService {
        override async record(): Promise<void> {
          throw new Error('the audit log is not available')
        }
      }
      const owner = await seedAccount(x.db, { username: `owner-${randomUUID()}` })
      const failing = new ApiTokenService(x.db, new UnavailableAuditLog(x.db))
      await expect(failing.createToken(by(owner))).rejects.toThrow('the audit log is not available')
      expect(await storedRows(owner.id)).toEqual([])
    })
  })

  describe('listTokens', () => {
    it("lists the caller's own tokens, oldest first, and nobody else's", async () => {
      const owner = await seedAccount(x.db, { username: `owner-${randomUUID()}` })
      const first = await service.createToken(by(owner))
      const second = await service.createToken(by(owner))
      await service.createToken(by(bob))
      const listed = await service.listTokens(by(owner))
      expect(listed.map((t) => t.id)).toEqual([first.token.id, second.token.id])
      for (const t of listed)
        expect(Object.keys(t).sort()).toEqual(['createdAt', 'expiresAt', 'id'])
    })

    it('lists nothing for someone without tokens or a caller id that is not a UUID', async () => {
      const owner = await seedAccount(x.db, { username: `owner-${randomUUID()}` })
      expect(await service.listTokens(by(owner))).toEqual([])
      expect(await service.listTokens({ accountId: 'nobody', channel: 'ui' })).toEqual([])
    })
  })

  describe('revokeToken', () => {
    it('deletes the token, so it is gone, and records the revocation', async () => {
      const owner = await seedAccount(x.db, { username: `owner-${randomUUID()}` })
      const { token, secret } = await service.createToken(by(owner))
      await service.revokeToken(by(owner), token.id)
      expect(await service.listTokens(by(owner))).toEqual([])
      const rows = await x.db
        .select()
        .from(apiTokens)
        .where(eq(apiTokens.secretHash, hashSecret(secret)))
      expect(rows).toEqual([])
      const [entry] = await x.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'api-token.revoked'), eq(auditLog.subjectId, token.id)))
      expect(entry).toMatchObject({ actorAccountId: owner.id, subjectType: 'api-token' })
    })

    it("refuses someone else's token as not found and leaves it working", async () => {
      const { token } = await service.createToken(by(alice))
      const error = await refused(service.revokeToken(by(bob), token.id), 'not-found')
      expect(error.message).toBe('You have no such token')
      expect((await service.listTokens(by(alice))).map((t) => t.id)).toContain(token.id)
    })

    it('refuses a token that does not exist, was revoked, or has an id that is not a UUID', async () => {
      const { token } = await service.createToken(by(alice))
      await service.revokeToken(by(alice), token.id)
      for (const id of [token.id, randomUUID(), 'abc']) {
        const error = await refused(service.revokeToken(by(alice), id), 'not-found')
        expect(error.message).toBe('You have no such token')
      }
      const error = await refused(
        service.revokeToken({ accountId: 'nobody', channel: 'ui' }, token.id),
        'not-found',
      )
      expect(error.message).toBe('You have no such token')
    })

    it('keeps the token when the audit log cannot be written', async () => {
      class UnavailableAuditLog extends AuditLogService {
        override async record(): Promise<void> {
          throw new Error('the audit log is not available')
        }
      }
      const { token } = await service.createToken(by(alice))
      const failing = new ApiTokenService(x.db, new UnavailableAuditLog(x.db))
      await expect(failing.revokeToken(by(alice), token.id)).rejects.toThrow(
        'the audit log is not available',
      )
      expect((await service.listTokens(by(alice))).map((t) => t.id)).toContain(token.id)
    })
  })

  it('refuses a caller who has no account and creates nothing', async () => {
    const nobody = randomUUID()
    // An id with no account is refused by the database's foreign key (PostgreSQL's 23503).
    await expect(service.createToken({ accountId: nobody, channel: 'ui' })).rejects.toMatchObject({
      cause: { code: '23503' },
    })
    expect(await storedRows(nobody)).toEqual([])
    const error = await refused(
      service.createToken({ accountId: 'nobody', channel: 'ui' }),
      'forbidden',
    )
    expect(error.message).toBe('Only people with an account can create a token')
  })
})

describe('the token routes against the database', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let bob: Seeded
  let carol: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  it('creates, lists and revokes a token of the caller, showing the secret only once', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: as(bob),
      payload: { expiresAt: '2099-01-01T00:00:00.000Z' },
    })
    expect(created.statusCode).toBe(201)
    const { token, secret } = created.json()
    expect(token.expiresAt).toBe('2099-01-01T00:00:00.000Z')

    const listed = await app.inject({ method: 'GET', url: '/api/tokens', headers: as(bob) })
    expect(listed.json()).toEqual([token])
    expect(listed.body).not.toContain(secret)

    const others = await app.inject({ method: 'GET', url: '/api/tokens', headers: as(carol) })
    expect(others.json()).toEqual([])
    const theirs = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${token.id}`,
      headers: as(carol),
    })
    expect(theirs.statusCode).toBe(404)

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${token.id}`,
      headers: as(bob),
    })
    expect(revoked.statusCode).toBe(204)
    expect(
      (await app.inject({ method: 'GET', url: '/api/tokens', headers: as(bob) })).json(),
    ).toEqual([])
  })
})
