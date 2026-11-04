import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import type { ApiToken } from '../service/api-tokens.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import type { Authenticator } from './caller.ts'

// The token routes translate requests for the token service and nothing more (DD-039); the rules
// themselves are tested against the database in test/integration/api-tokens.test.ts. Here the
// service is a stub, so these tests show what each route hands it and what it sends back.

const BOB = '6f1c2a5e-0000-4000-8000-000000000002'
const TOKEN_ID = '6f1c2a5e-0000-4000-8000-0000000000f1'
const TOKEN: ApiToken = {
  id: TOKEN_ID,
  createdAt: new Date('2027-03-01T09:30:00.000Z'),
  expiresAt: null,
}

const asBob: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer bob' ? { accountId: BOB, channel: 'ui' } : undefined
const bob = { authorization: 'Bearer bob' }
const caller = { accountId: BOB, channel: 'ui' }

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const tokens = {
    listTokens: vi.spyOn(services.apiTokens, 'listTokens'),
    createToken: vi.spyOn(services.apiTokens, 'createToken'),
    revokeToken: vi.spyOn(services.apiTokens, 'revokeToken'),
  }
  const app = buildApp({}, { authenticators: [asBob], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, tokens }
}

describe('GET /api/tokens', () => {
  it("sends the caller's tokens, with their times as ISO 8601 and nothing secret", async () => {
    const { app, tokens } = stubbed()
    tokens.listTokens.mockResolvedValue([
      TOKEN,
      { ...TOKEN, expiresAt: new Date('2027-04-01T00:00:00.000Z') },
    ])
    const response = await app.inject({ method: 'GET', url: '/api/tokens', headers: bob })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual([
      { id: TOKEN_ID, createdAt: '2027-03-01T09:30:00.000Z', expiresAt: null },
      {
        id: TOKEN_ID,
        createdAt: '2027-03-01T09:30:00.000Z',
        expiresAt: '2027-04-01T00:00:00.000Z',
      },
    ])
    expect(tokens.listTokens).toHaveBeenCalledWith(caller)
  })

  it('sends nothing the schema does not declare, a hash included', async () => {
    const { app, tokens } = stubbed()
    tokens.listTokens.mockResolvedValue([
      Object.assign({}, TOKEN, { secretHash: 'abc', accountId: BOB }),
    ])
    const response = await app.inject({ method: 'GET', url: '/api/tokens', headers: bob })
    expect(Object.keys(response.json()[0]).sort()).toEqual(['createdAt', 'expiresAt', 'id'])
  })

  it('refuses a caller no authenticator recognises with 401', async () => {
    const { app, tokens } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/tokens' })
    expect(response.statusCode).toBe(401)
    expect(tokens.listTokens).not.toHaveBeenCalled()
  })
})

describe('POST /api/tokens', () => {
  it('creates a token without an expiry date and sends it with its secret, as 201', async () => {
    const { app, tokens } = stubbed()
    tokens.createToken.mockResolvedValue({ token: TOKEN, secret: 'cst_secret' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: bob,
      payload: {},
    })
    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      token: { id: TOKEN_ID, createdAt: '2027-03-01T09:30:00.000Z', expiresAt: null },
      secret: 'cst_secret',
    })
    expect(tokens.createToken).toHaveBeenCalledWith(caller, {})
  })

  it('hands the service the expiry date as a date', async () => {
    const { app, tokens } = stubbed()
    tokens.createToken.mockResolvedValue({ token: TOKEN, secret: 'cst_secret' })
    await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: bob,
      payload: { expiresAt: '2027-04-01T00:00:00.000Z' },
    })
    expect(tokens.createToken).toHaveBeenCalledWith(caller, {
      expiresAt: new Date('2027-04-01T00:00:00.000Z'),
    })
  })

  it.each(['tomorrow', '2027-13-01T00:00:00Z', 42])(
    'refuses the expiry date %s before the service is asked',
    async (expiresAt) => {
      const { app, tokens } = stubbed()
      const response = await app.inject({
        method: 'POST',
        url: '/api/tokens',
        headers: bob,
        payload: { expiresAt },
      })
      expect(response.statusCode).toBe(400)
      expect(tokens.createToken).not.toHaveBeenCalled()
    },
  )

  it("answers 400 with the service's message when it refuses the expiry date", async () => {
    const { app, tokens } = stubbed()
    tokens.createToken.mockRejectedValue(
      new ServiceError('invalid', 'The expiry date must be in the future'),
    )
    const response = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: bob,
      payload: { expiresAt: '2020-01-01T00:00:00.000Z' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json().message).toBe('The expiry date must be in the future')
  })
})

describe('DELETE /api/tokens/:tokenId', () => {
  it('revokes the token and answers 204 with no body', async () => {
    const { app, tokens } = stubbed()
    tokens.revokeToken.mockResolvedValue()
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${TOKEN_ID}`,
      headers: bob,
    })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(tokens.revokeToken).toHaveBeenCalledWith(caller, TOKEN_ID)
  })

  it('refuses a token id that is not a UUID before the service is asked', async () => {
    const { app, tokens } = stubbed()
    const response = await app.inject({ method: 'DELETE', url: '/api/tokens/abc', headers: bob })
    expect(response.statusCode).toBe(400)
    expect(tokens.revokeToken).not.toHaveBeenCalled()
  })

  it('answers 404 when the caller has no such token', async () => {
    const { app, tokens } = stubbed()
    tokens.revokeToken.mockRejectedValue(new ServiceError('not-found', 'You have no such token'))
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${TOKEN_ID}`,
      headers: bob,
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('the OpenAPI description', () => {
  it('describes the token routes', async () => {
    const { app } = stubbed()
    const paths = (
      await app.inject({ method: 'GET', url: '/api/openapi.json', headers: bob })
    ).json().paths
    expect(Object.keys(paths['/api/tokens/']).sort()).toEqual(['get', 'post'])
    expect(Object.keys(paths['/api/tokens/{tokenId}'])).toEqual(['delete'])
  })
})
