import type { FastifyPluginAsync, RouteOptions } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.ts'
import { API_PREFIX, type ApiOptions, type ApiRouteGroup } from './api.ts'
import type { Authenticator } from './caller.ts'
import { OPENAPI_INFO, OPENAPI_PATH } from './openapi.ts'

const TOKEN = 'Bearer alice-token'
const aliceByHeader: Authenticator = async (request) =>
  request.headers.authorization === TOKEN ? { accountId: 'alice', channel: 'rest-api' } : undefined

const DESCRIPTION_URL = `${API_PREFIX}${OPENAPI_PATH}`

const project = {
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' } },
} as const

/** Routes of every kind a route group can have: reads with params and a query, and changes. */
const projectRoutes: FastifyPluginAsync = async (group) => {
  group.addSchema({ $id: 'Project', ...project })
  group.get(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: { search: { type: 'string' }, limit: { type: 'integer', minimum: 1 } },
        },
        response: { 200: { type: 'array', items: { $ref: 'Project#' } } },
      },
    },
    async () => [],
  )
  group.get(
    '/:projectId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: { projectId: { type: 'string', format: 'uuid' } },
        },
        response: { 200: { $ref: 'Project#' } },
      },
    },
    async () => ({ id: 'p', name: 'Apollo' }),
  )
  group.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string', minLength: 1 } },
          additionalProperties: false,
        },
        response: { 201: project },
      },
    },
    async () => ({ id: 'p', name: 'Apollo' }),
  )
  group.delete(
    '/:projectId',
    {
      schema: {
        params: { type: 'object', properties: { projectId: { type: 'string' } } },
        response: { 204: { type: 'null' } },
      },
    },
    async () => null,
  )
}

const tokenRoutes: FastifyPluginAsync = async (group) => {
  group.put(
    '/:tokenId/name',
    {
      schema: {
        params: { type: 'object', properties: { tokenId: { type: 'string' } } },
        body: { type: 'object', properties: { name: { type: 'string' } } },
        response: { '2xx': { type: 'object', properties: { name: { type: 'string' } } } },
      },
    },
    async () => ({ name: 'ci' }),
  )
}

const groups: ApiRouteGroup[] = [
  { prefix: '/projects', routes: projectRoutes },
  { prefix: '/tokens', routes: tokenRoutes },
]

interface Operation {
  parameters?: { in: string; name: string; required?: boolean; schema: unknown }[]
  requestBody?: { required?: boolean; content: Record<string, { schema: unknown }> }
  responses: Record<string, { content?: Record<string, { schema: unknown }> }>
}

interface Description {
  openapi: string
  info: { title: string; version: string }
  paths: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, unknown> }
}

let closers: (() => Promise<unknown>)[] = []

afterEach(async () => {
  await Promise.all(closers.map((close) => close()))
  closers = []
})

/**
 * Builds the app and records every route registered under the REST API, as Fastify itself
 * registers them, so the description can be checked against what the backend really serves.
 */
function appWith(api: ApiOptions) {
  const app = buildApp({}, { authenticators: [aliceByHeader], ...api })
  closers.push(() => app.close())
  const routes: Pick<RouteOptions, 'method' | 'url'>[] = []
  app.addHook('onRoute', (route) => {
    if (route.url.startsWith(`${API_PREFIX}/`)) routes.push(route)
  })
  return { app, routes }
}

async function describedBy(api: ApiOptions): Promise<{
  description: Description
  routes: Pick<RouteOptions, 'method' | 'url'>[]
}> {
  const { app, routes } = appWith(api)
  const response = await app.inject({
    method: 'GET',
    url: DESCRIPTION_URL,
    headers: { authorization: TOKEN },
  })
  expect(response.statusCode).toBe(200)
  return { description: response.json<Description>(), routes }
}

/** The OpenAPI path of a Fastify URL: `:name` becomes `{name}`, and a trailing slash goes. */
function openApiPath(url: string): string {
  return url.replace(/:(\w+)/g, '{$1}').replace(/(.)\/$/, '$1')
}

function operation(description: Description, method: string, url: string): Operation {
  const byPath = Object.fromEntries(
    Object.entries(description.paths).map(([path, item]) => [openApiPath(path), item]),
  )
  const found = byPath[openApiPath(url)]?.[method.toLowerCase()]
  if (!found) throw new Error(`the description has no ${method} ${url}`)
  return found
}

/** Follows a `#/components/schemas/...` reference to the schema it names. */
function resolved(description: Description, schema: unknown): unknown {
  if (typeof schema === 'object' && schema !== null && '$ref' in schema) {
    const name = String(schema.$ref).replace('#/components/schemas/', '')
    return description.components?.schemas?.[name]
  }
  return schema
}

function jsonSchema(content: Record<string, { schema: unknown }> | undefined): unknown {
  return content?.['application/json']?.schema
}

describe('the OpenAPI description (SC-063)', () => {
  it('is served beside the REST API as an OpenAPI 3.1 document', async () => {
    const { description } = await describedBy({ groups })
    expect(DESCRIPTION_URL).toBe('/api/openapi.json')
    expect(description.openapi).toBe('3.1.0')
    expect(description.info).toEqual(OPENAPI_INFO)
  })

  it('covers every route the running backend serves under the REST API', async () => {
    const { description, routes } = await describedBy({ groups })
    // The only HEAD routes left are the ones Fastify adds for each GET: one declared by hand is
    // refused at start (see below), and the GET it answers like is described.
    const served = routes.filter(
      (route) => route.method !== 'HEAD' && route.url !== DESCRIPTION_URL,
    )
    expect(served.length).toBeGreaterThanOrEqual(5)
    for (const route of served) {
      for (const method of [route.method].flat()) {
        expect(() => operation(description, method, route.url)).not.toThrow()
      }
    }
  })

  it('describes nothing the backend does not serve', async () => {
    const { description } = await describedBy({ groups })
    const described = Object.entries(description.paths).flatMap(([path, item]) =>
      Object.keys(item).map((method) => `${method.toUpperCase()} ${openApiPath(path)}`),
    )
    expect(described.toSorted()).toEqual(
      [
        'DELETE /api/projects/{projectId}',
        'GET /api/projects',
        'GET /api/projects/{projectId}',
        'POST /api/projects',
        'PUT /api/tokens/{tokenId}/name',
      ].toSorted(),
    )
  })

  it("covers every route of the backend's own route groups", async () => {
    // Without `groups`, the app serves the real `routeGroups`, which grow with every backend SC.
    const { description, routes } = await describedBy({})
    for (const route of routes) {
      if (route.method === 'HEAD' || route.url === DESCRIPTION_URL) continue
      for (const method of [route.method].flat()) {
        expect(() => operation(description, method, route.url)).not.toThrow()
      }
    }
  })

  it("describes a route's path parameters from its params schema", async () => {
    const { description } = await describedBy({ groups })
    const get = operation(description, 'GET', '/api/projects/:projectId')
    expect(get.parameters).toEqual([
      { in: 'path', name: 'projectId', required: true, schema: { type: 'string', format: 'uuid' } },
    ])
  })

  it("describes a route's query parameters from its querystring schema", async () => {
    const { description } = await describedBy({ groups })
    const list = operation(description, 'GET', '/api/projects')
    expect(list.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: 'query', name: 'search', schema: { type: 'string' } }),
        expect.objectContaining({
          in: 'query',
          name: 'limit',
          schema: { type: 'integer', minimum: 1 },
        }),
      ]),
    )
  })

  it("describes a route's request body from its body schema", async () => {
    const { description } = await describedBy({ groups })
    const create = operation(description, 'POST', '/api/projects')
    expect(create.requestBody?.required).toBe(true)
    expect(jsonSchema(create.requestBody?.content)).toEqual({
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string', minLength: 1 } },
      additionalProperties: false,
    })
  })

  it("describes a route's responses from its response schemas, by status", async () => {
    const { description } = await describedBy({ groups })
    expect(
      jsonSchema(operation(description, 'POST', '/api/projects').responses['201']?.content),
    ).toEqual(project)
    expect(
      Object.keys(operation(description, 'DELETE', '/api/projects/:projectId').responses),
    ).toEqual(['204'])
    const rename = operation(description, 'PUT', '/api/tokens/:tokenId/name')
    expect(jsonSchema(rename.requestBody?.content)).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
    })
    expect(jsonSchema(rename.responses['2XX']?.content)).toEqual({
      type: 'object',
      properties: { name: { type: 'string' } },
    })
  })

  it('carries the shared schemas a route refers to, so every reference resolves', async () => {
    const { description } = await describedBy({ groups })
    const one = jsonSchema(
      operation(description, 'GET', '/api/projects/:projectId').responses['200']?.content,
    )
    expect(resolved(description, one)).toMatchObject(project)
    const list = jsonSchema(
      operation(description, 'GET', '/api/projects').responses['200']?.content,
    )
    expect(list).toMatchObject({ type: 'array' })
    const items = typeof list === 'object' && list !== null && 'items' in list ? list.items : null
    expect(resolved(description, items)).toMatchObject(project)
    const refs = JSON.stringify(description).match(/"\$ref":"[^"]*"/g) ?? []
    expect(refs.length).toBeGreaterThanOrEqual(2)
    for (const ref of refs) {
      expect(resolved(description, JSON.parse(`{${ref}}`))).toBeDefined()
    }
  })

  it('follows the routes the backend runs with, so it matches the running version', async () => {
    const before = await describedBy({ groups: [groups[0]!] })
    const after = await describedBy({ groups })
    expect(
      Object.keys(before.description.paths).some((path) => path.startsWith('/api/tokens')),
    ).toBe(false)
    expect(() => operation(after.description, 'PUT', '/api/tokens/:tokenId/name')).not.toThrow()
  })

  it('leaves its own route out of the description', async () => {
    const { description } = await describedBy({ groups })
    expect(Object.keys(description.paths).map(openApiPath)).not.toContain(DESCRIPTION_URL)
  })

  it('refuses a stranger with 401 like every other route under the REST API', async () => {
    const { app } = appWith({ groups })
    const response = await app.inject({ method: 'GET', url: DESCRIPTION_URL })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Authentication required',
    })
  })
})

describe('routes the description could not cover', () => {
  const ok = { response: { 200: { type: 'object', properties: {} } } } as const

  async function starting(routes: FastifyPluginAsync, more: ApiRouteGroup[] = []) {
    const app = buildApp({}, { groups: [{ prefix: '/x', routes }, ...more] })
    closers.push(() => app.close())
    await app.ready()
  }

  it('refuses at start a route hidden from the description by `hide`', async () => {
    await expect(
      starting(async (g) => {
        g.get('/', { schema: { ...ok, hide: true } }, async () => ({}))
      }),
    ).rejects.toThrow(
      'REST API route GET /api/x would be hidden from the OpenAPI description by `hide`',
    )
  })

  it('refuses at start a route hidden from the description by the hidden tag', async () => {
    await expect(
      starting(async (g) => {
        g.get('/', { schema: { ...ok, tags: ['tasks', 'X-HIDDEN'] } }, async () => ({}))
      }),
    ).rejects.toThrow('would be hidden from the OpenAPI description by the X-HIDDEN tag')
  })

  it('refuses at start a route with a version constraint', async () => {
    await expect(
      starting(async (g) => {
        g.get('/v', { schema: ok, constraints: { version: '1.0.0' } }, async () => ({}))
      }),
    ).rejects.toThrow('would be described as one route with its other versions')
  })

  it('refuses at start a HEAD route declared by hand', async () => {
    await expect(
      starting(async (g) => {
        g.head('/h', { schema: ok }, async () => ({}))
      }),
    ).rejects.toThrow(
      'REST API route HEAD /api/x/h would be left out of the OpenAPI description as a HEAD route',
    )
  })

  it('refuses a HEAD declared by hand even beside a GET on the same path', async () => {
    await expect(
      starting(async (g) => {
        g.route({ method: ['GET', 'HEAD'], url: '/both', schema: ok, handler: async () => ({}) })
      }),
    ).rejects.toThrow('as a HEAD route declared by hand')
  })

  it('accepts the HEAD route Fastify adds for each GET, which answers like the GET', async () => {
    const { app, routes } = appWith({ groups })
    await app.ready()
    expect(routes.some((route) => route.method === 'HEAD')).toBe(true)
    const head = await app.inject({
      method: 'HEAD',
      url: '/api/projects',
      headers: { authorization: TOKEN },
    })
    expect(head.statusCode).toBe(200)
  })

  it('refuses at start one shared schema id added with different content in two groups', async () => {
    const withItem =
      (properties: object): FastifyPluginAsync =>
      async (g) => {
        g.addSchema({ $id: 'Item', type: 'object', properties })
        g.get('/', { schema: { response: { 200: { $ref: 'Item#' } } } }, async () => ({}))
      }
    await expect(
      starting(withItem({ a: { type: 'string' } }), [
        { prefix: '/y', routes: withItem({ b: { type: 'integer' } }) },
      ]),
    ).rejects.toThrow('REST API shared schema Item is added twice with different content')
  })

  it('accepts one shared schema id added with the same content in two groups', async () => {
    const withItem: FastifyPluginAsync = async (g) => {
      g.addSchema({ $id: 'Item', type: 'object', properties: { a: { type: 'string' } } })
      g.get('/', { schema: { response: { 200: { $ref: 'Item#' } } } }, async () => ({}))
    }
    await expect(starting(withItem, [{ prefix: '/y', routes: withItem }])).resolves.toBeUndefined()
  })
})
