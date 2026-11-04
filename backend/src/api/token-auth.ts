import type { FastifyRequest } from 'fastify'
import type { Caller } from './caller.ts'

/** Who a token's secret belongs to: the token service (SC-016) answers it. */
export interface TokenOwners {
  resolve(secret: string): Promise<string | undefined>
}

/** How a request carries its API token: `Authorization: Bearer <token>`. */
const BEARER = /^Bearer\s+(\S+)\s*$/i

/**
 * Token authentication for the REST API (SC-055, DD-048): recognises a request that carries a
 * personal access token that is neither revoked nor expired, and whose owner's account exists, as
 * made by that owner through the REST API channel. Anything else it does not recognise, so the
 * request is refused unless another authenticator recognises it. The token carries no roles of
 * its own: the service layer checks the owner's current roles on each call (FR-113).
 */
export function tokenAuthenticator(tokens: TokenOwners) {
  return async (request: Pick<FastifyRequest, 'headers'>): Promise<Caller | undefined> => {
    const header = request.headers.authorization
    const secret = header === undefined ? undefined : BEARER.exec(header)?.[1]
    if (secret === undefined) return undefined
    const accountId = await tokens.resolve(secret)
    return accountId === undefined ? undefined : { accountId, channel: 'rest-api' }
  }
}
