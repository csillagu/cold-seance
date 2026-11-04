import type { FastifyRequest } from 'fastify'
import type { Caller } from './caller.ts'
import { UnauthenticatedError } from './errors.ts'
import { sessionIdOf } from './session.ts'

/** Whose session an id is: the session service (SC-052, SC-107) answers it. */
export interface SessionOwners {
  resolve(sessionId: string): Promise<string | undefined>
}

/**
 * The session check (SC-107, DD-054): looks the session id in a request's cookie up in PostgreSQL,
 * and recognises the request as made by that session's person through the UI. A cookie whose
 * session does not exist, never created or ended by signing out, refuses the request outright; a
 * request with no session cookie is left to the other authenticators.
 */
export function sessionAuthenticator(owners: SessionOwners) {
  return async (request: Pick<FastifyRequest, 'headers'>): Promise<Caller | undefined> => {
    const sessionId = sessionIdOf(request.headers.cookie)
    if (sessionId === undefined) return undefined
    const accountId = await owners.resolve(sessionId)
    if (accountId === undefined) throw new UnauthenticatedError()
    return { accountId, channel: 'ui' }
  }
}
