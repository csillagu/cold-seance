import type { FastifyPluginAsync } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app.ts'
import { ServiceError } from '../service/errors.ts'
import { API_PREFIX, routeGroups, type ApiOptions, type ApiRouteGroup } from './api.ts'
import { callerOf, type Authenticator } from './caller.ts'

const TOKEN = 'Bearer alice-token'

/** Recognises one fixed header as `alice`, standing in for the authenticators of later SCs. */
const aliceByHeader: Authenticator = async (request) =>
  request.headers.authorization === TOKEN ? { accountId: 'alice' } : undefined

/** A stand-in for a service-layer module: it holds the rule, the route only calls it. */
const echoService = {
  rename(caller: { accountId: string }, name: string): { name: string; by: string } {
    if (name === 'taken') throw new ServiceError('conflict', 'The name taken is already in use')
    if (caller.accountId !== 'alice') throw new ServiceError('forbidden', 'Not allowed')
    return { name, by: caller.accountId }
  },
}

const echoRoutes: FastifyPluginAsync = async (group) => {
  group.post<{ Body: { name: string } }>(
    '/rename',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: { name: { type: 'string' }, by: { type: 'string' } },
          },
        },
      },
    },
    async (request) => {
      return echoService.rename(callerOf(request), request.body.name)
    },
  )
  group.get(
    '/whoami',
    {
      schema: {
        response: { 200: { type: 'object', properties: { accountId: { type: 'string' } } } },
      },
    },
    // The extra field shows that the response schema keeps undeclared data out of the answer.
    async (request) => ({ ...callerOf(request), secret: 'not for the caller' }),
  )
  group.get('/broken', { schema: { response: { 200: { type: 'object' } } } }, async () => {
    throw new Error('connection to db-internal:5432 refused')
  })
}

const echoGroup: ApiRouteGroup = { prefix: '/echo', routes: echoRoutes }

let closers: (() => Promise<unknown>)[] = []

afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

function appWith(api: ApiOptions) {
  const app = buildApp({}, api)
  closers.push(() => app.close())
  return app
}

describe('the REST API', () => {
  it('is served under /api, each route group under its own prefix', async () => {
    const app = appWith({ authenticators: [aliceByHeader], groups: [echoGroup] })
    const response = await app.inject({
      method: 'GET',
      url: `${API_PREFIX}/echo/whoami`,
      headers: { authorization: TOKEN },
    })
    expect(API_PREFIX).toBe('/api')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ accountId: 'alice' })
  })

  it('has no route groups yet: each backend block adds its own', () => {
    expect(routeGroups).toEqual([])
  })

  it('serves what its response schema declares and nothing more', async () => {
    const app = appWith({ authenticators: [aliceByHeader], groups: [echoGroup] })
    const response = await app.inject({
      method: 'GET',
      url: '/api/echo/whoami',
      headers: { authorization: TOKEN },
    })
    expect(response.json()).not.toHaveProperty('secret')
  })

  it('hands the caller and the translated request to the service layer', async () => {
    const app = appWith({ authenticators: [aliceByHeader], groups: [echoGroup] })
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo/rename',
      headers: { authorization: TOKEN },
      payload: { name: 'Apollo' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ name: 'Apollo', by: 'alice' })
  })
})

describe('authentication', () => {
  it('refuses with 401 a request that no authenticator recognises, before the route runs', async () => {
    const handler = vi.fn<() => Promise<object>>(async () => ({}))
    const group: ApiRouteGroup = {
      prefix: '/spy',
      routes: async (g) => {
        g.get('/', { schema: { response: { 200: { type: 'object' } } } }, handler)
      },
    }
    const app = appWith({ authenticators: [aliceByHeader], groups: [group] })
    const response = await app.inject({
      method: 'GET',
      url: '/api/spy',
      headers: { authorization: 'Bearer someone-else' },
    })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required',
    })
    expect(handler).not.toHaveBeenCalled()
  })

  it('refuses every request while no authenticator is configured', async () => {
    const app = appWith({ groups: [echoGroup] })
    const response = await app.inject({
      method: 'GET',
      url: '/api/echo/whoami',
      headers: { authorization: TOKEN },
    })
    expect(response.statusCode).toBe(401)
  })

  it('refuses before the body is read, so an unauthenticated invalid body still gets 401', async () => {
    const app = appWith({ authenticators: [aliceByHeader], groups: [echoGroup] })
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo/rename',
      payload: { wrong: true },
    })
    expect(response.statusCode).toBe(401)
  })

  it('asks the authenticators in turn and takes the first caller one recognises', async () => {
    const first = vi.fn<Authenticator>(async () => undefined)
    const second = vi.fn<Authenticator>(async () => ({ accountId: 'bob' }))
    const third = vi.fn<Authenticator>(async () => ({ accountId: 'carol' }))
    const app = appWith({ authenticators: [first, second, third], groups: [echoGroup] })
    const response = await app.inject({ method: 'GET', url: '/api/echo/whoami' })
    expect(response.json()).toEqual({ accountId: 'bob' })
    expect(first).toHaveBeenCalledOnce()
    expect(third).not.toHaveBeenCalled()
  })

  it('answers 500 without detail when an authenticator fails', async () => {
    const failing: Authenticator = async () => {
      throw new Error('token store unreachable at 10.0.0.7')
    }
    const app = appWith({ authenticators: [failing], groups: [echoGroup] })
    const response = await app.inject({ method: 'GET', url: '/api/echo/whoami' })
    expect(response.statusCode).toBe(500)
    expect(response.body).not.toContain('10.0.0.7')
  })

  it('does not authenticate requests outside the REST API', async () => {
    const authenticator = vi.fn<Authenticator>(async () => undefined)
    const app = appWith({ authenticators: [authenticator], groups: [echoGroup] })
    const response = await app.inject({ method: 'GET', url: '/elsewhere' })
    expect(response.statusCode).toBe(404)
    expect(authenticator).not.toHaveBeenCalled()
  })
})

describe('errors', () => {
  const as = { authorization: TOKEN }

  it('answers a service-layer refusal with its status and its message', async () => {
    const app = appWith({ authenticators: [aliceByHeader], groups: [echoGroup] })
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo/rename',
      headers: as,
      payload: { name: 'taken' },
    })
    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'The name taken is already in use',
    })
  })

  it('refuses with 400 a body that does not match the route schema, before the service is called', async () => {
    const spy = vi.spyOn(echoService, 'rename')
    const app = appWith({ authenticators: [aliceByHeader], groups: [echoGroup] })
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo/rename',
      headers: as,
      payload: { name: '' },
    })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({ statusCode: 400, error: 'Bad Request' })
    expect(response.json<{ message: string }>().message).toMatch(/name/)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('keeps the status Fastify gives a request it cannot take', async () => {
    const app = appWith({ authenticators: [aliceByHeader], groups: [echoGroup] })
    const response = await app.inject({
      method: 'POST',
      url: '/api/echo/rename',
      headers: { ...as, 'content-type': 'application/x-unknown' },
      payload: 'name=Apollo',
    })
    expect(response.statusCode).toBe(415)
    expect(response.json()).toMatchObject({ statusCode: 415, error: 'Unsupported Media Type' })
  })

  it('answers an unexpected fault with 500 and no internal detail, and logs it', async () => {
    const logged: string[] = []
    const app = buildApp(
      { logger: { level: 'error', stream: { write: (line: string) => logged.push(line) } } },
      { authenticators: [aliceByHeader], groups: [echoGroup] },
    )
    closers.push(() => app.close())
    const response = await app.inject({ method: 'GET', url: '/api/echo/broken', headers: as })
    expect(response.statusCode).toBe(500)
    expect(response.json()).toEqual({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Internal Server Error',
    })
    expect(logged.join('')).toContain('db-internal:5432')
  })
})

describe('route schemas', () => {
  async function registering(routes: FastifyPluginAsync) {
    const app = buildApp({}, { groups: [{ prefix: '/x', routes }] })
    closers.push(() => app.close())
    await app.ready()
  }

  it('refuses at start a route without a response schema', async () => {
    await expect(
      registering(async (g) => {
        g.get('/', async () => ({}))
      }),
    ).rejects.toThrow('REST API route GET /api/x lacks a response schema for its success status')
  })

  it('refuses at start a change route without a body schema', async () => {
    await expect(
      registering(async (g) => {
        g.post('/', { schema: { response: { 201: { type: 'object' } } } }, async () => ({}))
      }),
    ).rejects.toThrow('lacks a body schema')
  })

  it('refuses at start a route with URL parameters but no params schema', async () => {
    await expect(
      registering(async (g) => {
        g.get('/:id', { schema: { response: { 200: { type: 'object' } } } }, async () => ({}))
      }),
    ).rejects.toThrow('lacks a params schema')
  })

  it('accepts a route that declares every schema it needs', async () => {
    await expect(
      registering(async (g) => {
        g.put(
          '/:id',
          {
            schema: {
              params: { type: 'object', properties: { id: { type: 'string' } } },
              body: { type: 'object' },
              response: { 204: { type: 'null' } },
            },
          },
          async () => null,
        )
      }),
    ).resolves.toBeUndefined()
  })
})
