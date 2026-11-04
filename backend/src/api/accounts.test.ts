import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import type { Account } from '../service/accounts.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The account routes translate requests for the account service and nothing more (DD-039); the
// rules themselves are tested against the database in test/integration/accounts.test.ts. Here the
// service is a stub, so these tests show what each route hands it and what it sends back.

const ROOT = '6f1c2a5e-0000-4000-8000-000000000001'
const ERIN: Account = {
  id: '6f1c2a5e-0000-4000-8000-000000000002',
  username: 'erin',
  systemAdmin: false,
}

const asRoot: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer root'
    ? { accountId: ROOT, channel: 'rest-api' }
    : undefined

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

/**
 * The REST API over the real service layer, whose account methods are spied on so each test can
 * say what the service answers. The database pool is never connected: a call the test does not
 * stub would fail rather than reach a database.
 */
function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const accounts = {
    listAccounts: vi.spyOn(services.accounts, 'listAccounts'),
    createAccount: vi.spyOn(services.accounts, 'createAccount'),
    makeSystemAdmin: vi.spyOn(services.accounts, 'makeSystemAdmin'),
    link: vi.spyOn(services.githubLinks, 'link'),
    linkOf: vi.spyOn(services.githubLinks, 'linkOf'),
  }
  const app = buildApp({}, { authenticators: [asRoot], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, accounts }
}

const root = { authorization: 'Bearer root' }

describe('GET /api/accounts', () => {
  it("lists the accounts the service gives for the caller, without anything they don't declare", async () => {
    const { app, accounts } = stubbed()
    const withHash = { ...ERIN, passwordHash: '$argon2id$secret' }
    accounts.listAccounts.mockResolvedValue([withHash])
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts',
      headers: root,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([ERIN])
    expect(accounts.listAccounts).toHaveBeenCalledWith({ accountId: ROOT, channel: 'rest-api' })
  })
})

describe('POST /api/accounts', () => {
  it('creates the account through the service and answers 201 with it', async () => {
    const { app, accounts } = stubbed()
    accounts.createAccount.mockResolvedValue(ERIN)
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: root,
      payload: { username: 'erin', password: 'erin-password' },
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual(ERIN)
    expect(accounts.createAccount).toHaveBeenCalledWith(
      { accountId: ROOT, channel: 'rest-api' },
      { username: 'erin', password: 'erin-password' },
    )
  })

  it.each([
    ['no password', { username: 'erin' }],
    ['no username', { password: 'x' }],
    ['a username that is an object', { username: { name: 'erin' }, password: 'x' }],
  ])('refuses a body with %s, before the service is called', async (_, payload) => {
    const { app, accounts } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: root,
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(accounts.createAccount).not.toHaveBeenCalled()
  })

  it('hands the service only the username and password, so the body cannot make a system admin', async () => {
    const { app, accounts } = stubbed()
    accounts.createAccount.mockResolvedValue(ERIN)
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: root,
      payload: { username: 'erin', password: 'x', systemAdmin: true },
    })
    expect(response.statusCode).toBe(201)
    expect(accounts.createAccount).toHaveBeenCalledWith(
      { accountId: ROOT, channel: 'rest-api' },
      { username: 'erin', password: 'x' },
    )
  })

  it("answers the service's refusal as the REST API's error", async () => {
    const { app, accounts } = stubbed()
    accounts.createAccount.mockRejectedValue(
      new ServiceError('forbidden', 'Only system admins can administer accounts'),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      headers: root,
      payload: { username: 'erin', password: 'x' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      message: 'Only system admins can administer accounts',
    })
  })

  it('refuses a caller nobody authenticated, before the service is called', async () => {
    const { app, accounts } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts',
      payload: { username: 'erin', password: 'x' },
    })
    expect(response.statusCode).toBe(401)
    expect(accounts.createAccount).not.toHaveBeenCalled()
  })
})

describe('POST /api/accounts/system-admins', () => {
  it('makes the account a system admin through the service and answers with it', async () => {
    const { app, accounts } = stubbed()
    accounts.makeSystemAdmin.mockResolvedValue({ ...ERIN, systemAdmin: true })
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/system-admins',
      headers: root,
      payload: { accountId: ERIN.id },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ...ERIN, systemAdmin: true })
    expect(accounts.makeSystemAdmin).toHaveBeenCalledWith(
      { accountId: ROOT, channel: 'rest-api' },
      ERIN.id,
    )
  })

  it('refuses a body without the account, before the service is called', async () => {
    const { app, accounts } = stubbed()
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/system-admins',
      headers: root,
      payload: {},
    })
    expect(response.statusCode).toBe(400)
    expect(accounts.makeSystemAdmin).not.toHaveBeenCalled()
  })

  it('answers 404 when the service finds no such account', async () => {
    const { app, accounts } = stubbed()
    accounts.makeSystemAdmin.mockRejectedValue(
      new ServiceError('not-found', 'There is no such account'),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/accounts/system-admins',
      headers: root,
      payload: { accountId: ERIN.id },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ message: 'There is no such account' })
  })
})

describe('the GitHub account link routes', () => {
  const caller = { accountId: ROOT, channel: 'rest-api' }

  it("GET reads the person's link from the service", async () => {
    const { app, accounts } = stubbed()
    accounts.linkOf.mockResolvedValue({ accountId: ERIN.id, githubLogin: 'tc-erin' })
    const response = await app.inject({
      method: 'GET',
      url: `/api/accounts/${ERIN.id}/github`,
      headers: root,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ accountId: ERIN.id, githubLogin: 'tc-erin' })
    expect(accounts.linkOf).toHaveBeenCalledWith(caller, ERIN.id)
  })

  it('GET sends an account with no link with a null name', async () => {
    const { app, accounts } = stubbed()
    accounts.linkOf.mockResolvedValue({ accountId: ERIN.id, githubLogin: null })
    const response = await app.inject({
      method: 'GET',
      url: `/api/accounts/${ERIN.id}/github`,
      headers: root,
    })
    expect(response.json()).toEqual({ accountId: ERIN.id, githubLogin: null })
  })

  it('PUT hands the service the person and the name, and sends the link', async () => {
    const { app, accounts } = stubbed()
    accounts.link.mockResolvedValue({ accountId: ERIN.id, githubLogin: 'tc-erin' })
    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${ERIN.id}/github`,
      headers: root,
      payload: { githubLogin: 'tc-erin' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ accountId: ERIN.id, githubLogin: 'tc-erin' })
    expect(accounts.link).toHaveBeenCalledWith(caller, ERIN.id, 'tc-erin')
  })

  it.each([
    ['no name', {}],
    ['a name that is not text', { githubLogin: { name: 'tc-erin' } }],
  ])('PUT refuses %s before the service is asked', async (_, payload) => {
    const { app, accounts } = stubbed()
    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${ERIN.id}/github`,
      headers: root,
      payload,
    })
    expect(response.statusCode).toBe(400)
    expect(accounts.link).not.toHaveBeenCalled()
  })

  it('refuses an account id that is not a UUID before the service is asked', async () => {
    const { app, accounts } = stubbed()
    const response = await app.inject({
      method: 'GET',
      url: '/api/accounts/erin/github',
      headers: root,
    })
    expect(response.statusCode).toBe(400)
    expect(accounts.linkOf).not.toHaveBeenCalled()
  })

  it("answers 409 with the service's message for a GitHub account linked to someone else", async () => {
    const { app, accounts } = stubbed()
    accounts.link.mockRejectedValue(
      new ServiceError(
        'conflict',
        'The GitHub account tc-erin is already linked to another account',
      ),
    )
    const response = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${ERIN.id}/github`,
      headers: root,
      payload: { githubLogin: 'tc-erin' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json().message).toBe(
      'The GitHub account tc-erin is already linked to another account',
    )
  })
})
