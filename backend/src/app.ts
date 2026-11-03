import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { API_PREFIX, restApi, type ApiOptions } from './api/api.ts'

/**
 * Builds the HTTP application without starting it, so tests can drive it with `inject()`. The
 * REST API is served under `API_PREFIX` (SC-026, DD-044).
 */
export function buildApp(
  options: FastifyServerOptions = {},
  api: ApiOptions = {},
): FastifyInstance {
  const app = Fastify(options)
  void app.register(restApi(api), { prefix: API_PREFIX })
  return app
}
