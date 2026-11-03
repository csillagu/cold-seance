import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { RouteGroupOptions } from './api.ts'

/** The cookie the browser keeps its session's id in (DD-054). */
export const SESSION_COOKIE = 'session'

/**
 * The session cookie for `sessionId`: page scripts cannot read it (`HttpOnly`), it is sent only
 * over HTTPS (`Secure`), and not with requests other sites start (`SameSite=Strict`) (DD-054).
 * Browsers treat `localhost` as secure, so it works in development without HTTPS.
 */
export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Strict`
}

/** Sets the session cookie on the reply. */
export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  void reply.header('set-cookie', sessionCookie(sessionId))
}

/**
 * The routes of the browser's session (SC-052, SC-026): sign in. Signing in is the one route a
 * caller reaches without being signed in already, so it is public; it only translates the
 * request, and the session service decides (DD-039).
 */
export const sessionRoutes: FastifyPluginAsync<RouteGroupOptions> = async (group, { services }) => {
  group.post<{ Body: { username: string; password: string } }>(
    '/',
    {
      config: { public: true },
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string' }, password: { type: 'string' } },
          additionalProperties: false,
        },
        response: { 204: { type: 'null', description: 'Signed in; the session cookie is set.' } },
      },
    },
    async (request, reply) => {
      const { sessionId } = await services.sessions.signIn(request.body)
      setSessionCookie(reply, sessionId)
      return reply.code(204).send()
    },
  )
}
