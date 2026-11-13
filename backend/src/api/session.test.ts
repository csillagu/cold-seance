import type { FastifyPluginAsync } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import { SIGN_IN_REFUSED, SIGN_OUT_NOT_YOURS } from '../service/sessions.ts'
import type { Authenticator } from './caller.ts'
import { CLEARED_SESSION_COOKIE, SESSION_COOKIE, sessionCookie } from './session.ts'

// The sign-in route translates requests for the session service and nothing more (DD-039); the
// rules themselves are tested against the database in test/integration/sessions.test.ts.

const ALICE = '6f1c2a5e-0000-4000-8000-000000000001'

let closers: (() => Promise<unknown>)[] = []
afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

/** An authenticator that recognises nobody, as for a browser that is not signed in. */
const nobody: Authenticator = async () => undefined

/** Recognises a request that names its caller in `x-caller`, as signed in through the UI. */
const named: Authenticator = async (request) => {
  const accountId = request.headers['x-caller']
  return typeof accountId === 'string' ? { accountId, channel: 'ui' } : undefined
}

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const signIn = vi.spyOn(services.sessions, 'signIn')
  const signOut = vi.spyOn(services.sessions, 'signOut')
  const ownAccount = vi.spyOn(services.accounts, 'ownAccount')
  const app = buildApp({}, { authenticators: [named], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, signIn, signOut, ownAccount }
}

describe('the session cookie', () => {
  it('cannot be read by page scripts, is sent only over HTTPS and not with other sites’ requests (DD-054)', () => {
    const cookie = sessionCookie('abc')
    expect(cookie.split('; ')).toEqual([
      `${SESSION_COOKIE}=abc`,
      'Path=/',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
    ])
  })
})

describe('POST /api/session', () => {
  it('signs in a caller who is not signed in, setting the session cookie, with no body', async () => {
    const { app, signIn } = stubbed()
    signIn.mockResolvedValue({ accountId: ALICE, sessionId: 'the-session-id' })
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: 'alice', password: 'pw' },
    })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(response.headers['set-cookie']).toBe(sessionCookie('the-session-id'))
    expect(signIn).toHaveBeenCalledWith({ username: 'alice', password: 'pw' })
  })

  it('answers wrong credentials with 401, the service’s message, and no cookie', async () => {
    const { app, signIn } = stubbed()
    signIn.mockRejectedValue(new ServiceError('unauthenticated', SIGN_IN_REFUSED))
    const response = await app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { username: 'alice', password: 'wrong' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: SIGN_IN_REFUSED,
    })
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it.each([
    ['no password', { username: 'alice' }],
    ['no username', { password: 'pw' }],
    ['a password that is not text', { username: 'alice', password: { pw: 1 } }],
  ])('refuses %s before the service is asked', async (_, payload) => {
    const { app, signIn } = stubbed()
    const response = await app.inject({ method: 'POST', url: '/api/session', payload })
    expect(response.statusCode).toBe(400)
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('the cleared session cookie', () => {
  it('is the session cookie, empty, expiring at once, with the same attributes', () => {
    expect(CLEARED_SESSION_COOKIE.split('; ')).toEqual([
      `${SESSION_COOKIE}=`,
      'Path=/',
      'Max-Age=0',
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
    ])
  })
})

describe('GET /api/session', () => {
  it("answers the caller's own account", async () => {
    const { app, ownAccount } = stubbed()
    ownAccount.mockResolvedValue({ id: ALICE, username: 'alice', systemAdmin: false })
    const response = await app.inject({
      method: 'GET',
      url: '/api/session',
      headers: { 'x-caller': ALICE },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ id: ALICE, username: 'alice', systemAdmin: false })
    expect(ownAccount).toHaveBeenCalledWith({ accountId: ALICE, channel: 'ui' })
  })

  it('refuses a caller no authenticator recognises, before the service is asked', async () => {
    const { app, ownAccount } = stubbed()
    const response = await app.inject({ method: 'GET', url: '/api/session' })
    expect(response.statusCode).toBe(401)
    expect(ownAccount).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/session', () => {
  it("signs the caller out of the cookie's session and clears the cookie, with no body", async () => {
    const { app, signOut } = stubbed()
    signOut.mockResolvedValue()
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { 'x-caller': ALICE, cookie: 'theme=dark; __Host-session=the-session-id' },
    })
    expect(response.statusCode).toBe(204)
    expect(response.body).toBe('')
    expect(response.headers['set-cookie']).toBe(CLEARED_SESSION_COOKIE)
    expect(signOut).toHaveBeenCalledWith({ accountId: ALICE, channel: 'ui' }, 'the-session-id')
  })

  it('asks the service nothing when the request carries no session cookie, and still clears it', async () => {
    const { app, signOut } = stubbed()
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { 'x-caller': ALICE },
    })
    expect(response.statusCode).toBe(204)
    expect(response.headers['set-cookie']).toBe(CLEARED_SESSION_COOKIE)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('refuses a caller no authenticator recognises, before the service is asked', async () => {
    const { app, signOut } = stubbed()
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { cookie: '__Host-session=the-session-id' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(signOut).not.toHaveBeenCalled()
  })

  it("answers the service's refusal of someone else's session with 403, leaving the cookie", async () => {
    const { app, signOut } = stubbed()
    signOut.mockRejectedValue(new ServiceError('forbidden', SIGN_OUT_NOT_YOURS))
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { 'x-caller': ALICE, cookie: '__Host-session=bobs-session' },
    })
    expect(response.statusCode).toBe(403)
    expect(response.json().message).toBe(SIGN_OUT_NOT_YOURS)
    expect(response.headers['set-cookie']).toBeUndefined()
  })

  it('answers a failure of the service as a fault of the backend', async () => {
    const { app, signOut } = stubbed()
    signOut.mockRejectedValue(new Error('database down'))
    const response = await app.inject({
      method: 'DELETE',
      url: '/api/session',
      headers: { 'x-caller': ALICE, cookie: '__Host-session=the-session-id' },
    })
    expect(response.statusCode).toBe(500)
    expect(response.json().message).toBe('Internal Server Error')
  })
})

describe('public routes', () => {
  it('are reached without authentication only where a route says so', async () => {
    const routes: FastifyPluginAsync = async (group) => {
      const reply = { schema: { response: { 200: { type: 'string' } } } }
      group.get('/open', { ...reply, config: { public: true } }, async () => 'open')
      group.get('/closed', reply, async () => 'closed')
    }
    const app = buildApp({}, { authenticators: [nobody], groups: [{ prefix: '/x', routes }] })
    closers.push(() => app.close())
    expect((await app.inject({ method: 'GET', url: '/api/x/open' })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/api/x/closed' })).statusCode).toBe(401)
    // A route that does not exist is not public: a stranger still learns nothing.
    expect((await app.inject({ method: 'GET', url: '/api/x/none' })).statusCode).toBe(401)
  })
})

describe('the REST API’s own routes', () => {
  it('have exactly one public route: signing in', async () => {
    const app = buildApp()
    closers.push(() => app.close())
    const open: string[] = []
    app.addHook('onRoute', (route) => {
      if (route.config?.public === true) open.push(`${String(route.method)} ${route.url}`)
    })
    await app.ready()
    expect(open).toEqual(['POST /api/session'])
  })

  it('take a sign-in only as JSON, so another site cannot post one from a form', async () => {
    const { app, signIn } = stubbed()
    for (const [type, payload] of [
      ['application/x-www-form-urlencoded', 'username=alice&password=pw'],
      ['text/plain', '{"username":"alice","password":"pw"}'],
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/session',
        headers: { 'content-type': type! },
        payload,
      })
      expect(response.statusCode).toBeGreaterThanOrEqual(400)
    }
    expect(signIn).not.toHaveBeenCalled()
  })
})
