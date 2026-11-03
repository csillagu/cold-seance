import type { FastifyPluginAsync } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { createDatabase } from '../db/client.ts'
import { ServiceError } from '../service/errors.ts'
import { createServices } from '../service/services.ts'
import { SIGN_IN_REFUSED } from '../service/sessions.ts'
import type { Authenticator } from './caller.ts'
import { SESSION_COOKIE, sessionCookie } from './session.ts'

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

function stubbed() {
  const { db, close } = createDatabase('postgres://nobody@unused.invalid/none')
  const services = createServices(db)
  const signIn = vi.spyOn(services.sessions, 'signIn')
  const app = buildApp({}, { authenticators: [nobody], services })
  closers.push(async () => {
    await app.close()
    await close()
  })
  return { app, signIn }
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
