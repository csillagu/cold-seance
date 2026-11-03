import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { API_PREFIX, restApi, type ApiOptions } from './api/api.ts'
import { serveFrontend } from './frontend.ts'

export interface WebOptions {
  /** The built frontend to serve outside the REST API (SC-028); none is served unless given. */
  frontendDir?: string
}

/**
 * Builds the HTTP application without starting it, so tests can drive it with `inject()`. The
 * REST API is served under `API_PREFIX` (SC-026, DD-044), and the built frontend, if given, at the
 * root.
 */
export function buildApp(
  options: FastifyServerOptions = {},
  api: ApiOptions = {},
  web: WebOptions = {},
): FastifyInstance {
  const app = Fastify(options)
  void app.register(restApi(api), { prefix: API_PREFIX })
  if (web.frontendDir !== undefined) serveFrontend(app, web.frontendDir)
  return app
}
