import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Authenticator } from './caller.ts'
import { errorBody, handleApiError, UnauthenticatedError } from './errors.ts'
import { missingSchemas } from './schema-guard.ts'

/** Where the REST API is served. */
export const API_PREFIX = '/api'

/**
 * One group of REST API routes, one for each part of the service layer (SC-026): its routes are
 * served under `API_PREFIX` followed by `prefix`. Each route declares its schemas, takes its
 * caller from `callerOf(request)`, translates the request and calls the service layer; no rule
 * lives in a route (DD-039, DD-044).
 */
export interface ApiRouteGroup {
  prefix: string
  routes: FastifyPluginAsync
}

/**
 * The route groups of the REST API. Each backend block adds its group here as its solution
 * component lands; the list is complete when every read and change the UI offers has a route.
 */
export const routeGroups: readonly ApiRouteGroup[] = []

export interface ApiOptions {
  /** Asked in turn for the caller of each request; the first that recognises one wins. */
  authenticators?: readonly Authenticator[]
  /** The route groups to serve; `routeGroups` unless a test passes its own. */
  groups?: readonly ApiRouteGroup[]
}

/**
 * The REST API (SC-026). Every route in it authenticates its caller before anything else runs, so
 * a request no authenticator recognises is refused with 401 and never reaches a route, nor learns
 * whether the route exists; refuses at registration a route that lacks its schemas; and answers
 * errors in one shape.
 */
export function restApi(options: ApiOptions = {}): FastifyPluginAsync {
  const authenticators = options.authenticators ?? []
  const groups = options.groups ?? routeGroups

  return async (api: FastifyInstance) => {
    api.decorateRequest('caller', null)

    api.addHook('onRoute', (route) => {
      const problems = missingSchemas(route)
      if (problems.length > 0) {
        throw new Error(
          `REST API route ${String(route.method)} ${route.url} lacks ${problems.join(', ')}`,
        )
      }
    })

    api.addHook('onRequest', async (request) => {
      for (const authenticate of authenticators) {
        request.caller = (await authenticate(request)) ?? null
        if (request.caller) return
      }
      throw new UnauthenticatedError()
    })

    api.setErrorHandler(handleApiError)
    // Unknown routes under the API answer in the API's own shape, and only to an authenticated
    // caller: the onRequest hook above runs first, so a stranger cannot map which routes exist.
    api.setNotFoundHandler(async (_request, reply) =>
      reply.code(404).send(errorBody(404, 'Not Found')),
    )

    for (const group of groups) {
      await api.register(group.routes, { prefix: group.prefix })
    }
  }
}
