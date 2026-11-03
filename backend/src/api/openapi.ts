import swagger from '@fastify/swagger'
import type { FastifyInstance } from 'fastify'

/** Where the OpenAPI description is served, under the REST API's own prefix. */
export const OPENAPI_PATH = '/openapi.json'

/**
 * The version the description gives in `info.version`. The description itself is generated from
 * the routes the running backend has registered, so it always matches that backend.
 */
export const OPENAPI_INFO = {
  title: 'cold-seance REST API',
  version: '0.0.0',
} as const

/**
 * The OpenAPI description of the REST API (SC-063), generated from the routes' JSON schemas
 * (DD-044). It is registered into the REST API's context before the route groups, so it collects
 * exactly the REST API's routes as they are registered, and is served as a route of its own beside
 * them. That route sits behind the REST API's authentication like every other path under it, so a
 * stranger cannot map the routes by reading the description either. It leaves itself out of the
 * description, which describes the API, not the document that describes it.
 */
export async function openApiDescription(api: FastifyInstance): Promise<void> {
  await api.register(swagger, {
    openapi: { openapi: '3.1.0', info: { ...OPENAPI_INFO } },
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
}
