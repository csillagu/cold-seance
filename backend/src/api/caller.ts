import type { FastifyRequest } from 'fastify'
import type { Caller } from '../service/caller.ts'

/** The account a REST API request is made for, as an authenticator establishes it. */
export type { Caller }

/**
 * Establishes who made a request, for example from a session cookie or an API token, or answers
 * `undefined` when the request carries nothing it recognises. The authenticators themselves come
 * with their own solution components; the REST API only asks them in turn.
 */
export type Authenticator = (request: FastifyRequest) => Promise<Caller | undefined>

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * A route any caller reaches, authenticated or not: only signing in (SC-052) and the GitHub
     * webhook endpoint (SC-105), which checks each delivery's signature instead. Every other
     * route of the REST API refuses a caller no authenticator recognises.
     */
    public?: boolean
  }

  interface FastifyRequest {
    /** Set on every REST API request before its handler runs; not set outside the REST API. */
    caller?: Caller | null
  }
}

/**
 * The caller of a REST API request. A route handler calls this to pass the caller on to the
 * service layer, which makes the permission checks.
 */
export function callerOf(request: Pick<FastifyRequest, 'caller'>): Caller {
  if (!request.caller) {
    throw new Error('callerOf() was called for a request that was not authenticated')
  }
  return request.caller
}
