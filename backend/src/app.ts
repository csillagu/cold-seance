import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'

/**
 * Builds the HTTP application without starting it, so tests can drive it with `inject()`.
 * Route groups are registered here as their solution components land (SC-026, DD-044).
 */
export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options)
  return app
}
