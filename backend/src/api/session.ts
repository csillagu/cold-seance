import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import type { RouteGroupOptions } from './api.ts'
import { callerOf } from './caller.ts'

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

/**
 * What clears the session cookie in the browser once its session is deleted: the same cookie,
 * empty, expiring at once.
 */
export const CLEARED_SESSION_COOKIE = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`

/**
 * The session id in a request's `Cookie` header, or `undefined` if it carries no session cookie,
 * or an empty one. A header with several session cookies gives the first, as browsers send the
 * most specific first.
 */
export function sessionIdOf(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined
  for (const pair of cookieHeader.split(';')) {
    const at = pair.indexOf('=')
    if (at === -1 || pair.slice(0, at).trim() !== SESSION_COOKIE) continue
    const value = pair.slice(at + 1).trim()
    return value === '' ? undefined : value
  }
  return undefined
}

/** Sets the session cookie on the reply. */
export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  void reply.header('set-cookie', sessionCookie(sessionId))
}

/**
 * The routes of the browser's session (SC-026): sign in (SC-052) and sign out (SC-107). Signing in
 * is the one route a caller reaches without being signed in already, so it is public; signing out
 * is reached only by a caller the session check recognises. Both only translate the request, and
 * the session service decides (DD-039).
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

  group.delete(
    '/',
    {
      schema: {
        response: {
          204: {
            type: 'null',
            description: "Signed out: the cookie's session is deleted and the cookie cleared.",
          },
        },
      },
    },
    async (request, reply) => {
      const sessionId = sessionIdOf(request.headers.cookie)
      if (sessionId !== undefined) await services.sessions.signOut(callerOf(request), sessionId)
      void reply.header('set-cookie', CLEARED_SESSION_COOKIE)
      return reply.code(204).send()
    },
  )
}
