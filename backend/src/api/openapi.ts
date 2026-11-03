import { isDeepStrictEqual } from 'node:util'
import swagger from '@fastify/swagger'
import type { FastifyInstance, RouteOptions } from 'fastify'

/** Where the OpenAPI description is served, under the REST API's own prefix. */
export const OPENAPI_PATH = '/openapi.json'

/**
 * The description's `info`. Its `version` is a placeholder until the backend is given a version
 * number of its own; the description's paths and schemas, which are generated from the routes the
 * running backend has registered, are what always match that backend.
 */
export const OPENAPI_INFO = {
  title: 'cold-seance REST API',
  version: '0.0.0',
} as const

/** The tag `@fastify/swagger` leaves out of the description, its default `hiddenTag`. */
const HIDDEN_TAG = 'X-HIDDEN'

/**
 * The OpenAPI description of the REST API (SC-063), generated from the routes' JSON schemas
 * (DD-044). It is registered into the REST API's context before the route groups, so it collects
 * exactly the REST API's routes as they are registered, and is served as a route of its own beside
 * them. That route sits behind the REST API's authentication like every other path under it, so a
 * stranger cannot map the routes by reading the description either. It leaves itself out of the
 * description, which describes the API, not the document that describes it.
 *
 * So that the description covers every route, as SC-063 requires, the REST API refuses at start
 * what would leave a route out of it or describe it wrongly: see `undescribable` and
 * `refuseConflictingSchemas`.
 */
export async function openApiDescription(api: FastifyInstance): Promise<void> {
  await api.register(swagger, {
    openapi: { openapi: '3.1.0', info: { ...OPENAPI_INFO } },
    hiddenTag: HIDDEN_TAG,
  })

  api.get(
    OPENAPI_PATH,
    {
      schema: {
        hide: true,
        response: { 200: { type: 'object', additionalProperties: {} } },
      },
    },
    async () => api.swagger(),
  )

  // Added after the description's own route, so its `hide` is the only one allowed.
  const refuse = undescribable()
  api.addHook('onRoute', (route) => {
    const problems = refuse(route)
    if (problems.length > 0) {
      throw new Error(
        `REST API route ${String(route.method)} ${route.url} would ${problems.join(', and ')}`,
      )
    }
  })
  refuseConflictingSchemas(api)
}

/**
 * Answers, for each route in turn, what in it would leave it out of the OpenAPI description or
 * describe it as something it is not: a `hide` flag or the hidden tag; a version constraint, as
 * the description holds only one route per method and path; or a HEAD route declared by hand,
 * which `@fastify/swagger` leaves out. The HEAD route Fastify adds for each GET answers like that
 * GET, which the description already covers, and is told apart by sharing the GET's handler.
 * Empty when there is nothing.
 */
export function undescribable(): (route: RouteOptions) => string[] {
  const getHandlers = new Set<RouteOptions['handler']>()

  return (route) => {
    const methods = [route.method].flat().map((method) => method.toUpperCase())
    const schema = route.schema ?? {}
    const problems: string[] = []

    if (schema.hide === true) problems.push('be hidden from the OpenAPI description by `hide`')
    if (schema.tags?.includes(HIDDEN_TAG)) {
      problems.push(`be hidden from the OpenAPI description by the ${HIDDEN_TAG} tag`)
    }
    const constraints: unknown = route.constraints
    if (typeof constraints === 'object' && constraints !== null && 'version' in constraints) {
      problems.push('be described as one route with its other versions, by its version constraint')
    }

    if (methods.includes('GET')) getHandlers.add(route.handler)
    const fastifysOwnHead = methods.length === 1 && getHandlers.has(route.handler)
    if (methods.includes('HEAD') && !fastifysOwnHead) {
      problems.push('be left out of the OpenAPI description as a HEAD route declared by hand')
    }
    return problems
  }
}

/**
 * Refuses at start two shared schemas with the same `$id` and different content, added in
 * different route groups. Fastify keeps them apart, each group validating against its own, but
 * the description has one place per `$id` and would describe the routes of one group with the
 * other's schema.
 */
export function refuseConflictingSchemas(api: FastifyInstance): void {
  const contexts: FastifyInstance[] = [api]
  api.addHook('onRegister', (instance) => {
    contexts.push(instance)
  })
  api.addHook('onReady', async () => {
    const seen = new Map<string, unknown>()
    for (const context of contexts) {
      for (const [id, schema] of Object.entries(context.getSchemas())) {
        if (seen.has(id) && !isDeepStrictEqual(seen.get(id), schema)) {
          throw new Error(
            `REST API shared schema ${id} is added twice with different content; the OpenAPI ` +
              'description would describe one with the other',
          )
        }
        seen.set(id, schema)
      }
    }
  })
}
