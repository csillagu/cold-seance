/**
 * The ways a service-layer call can refuse a request (DD-039). The service layer throws a
 * `ServiceError`; the REST API and the MCP server translate it for their callers, so a rule that
 * refuses a change refuses it the same way through every channel (FR-115). `unauthenticated`
 * refuses to sign someone in whose credentials are not right; `not-visible` refuses a project the
 * caller cannot see at all (FR-017); `forbidden`, something their role there, or their account,
 * does not allow; `unavailable`, a request that needs a service outside the tool, such as GitHub,
 * which could not answer it.
 */
export type ServiceErrorKind =
  | 'unauthenticated'
  | 'invalid'
  | 'forbidden'
  | 'not-visible'
  | 'not-found'
  | 'conflict'
  | 'unavailable'

export class ServiceError extends Error {
  readonly kind: ServiceErrorKind

  constructor(kind: ServiceErrorKind, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.kind = kind
  }
}

/**
 * What someone is told when they ask for a project they cannot see (FR-017, SC-051): plainly that
 * the project is not visible to them, never that it might not exist or might be deleted. A
 * project that does not exist is answered the same way, so the answer tells nothing about which
 * projects exist.
 */
export const NOT_VISIBLE_MESSAGE = 'This project is not visible to you'

export function notVisible(): ServiceError {
  return new ServiceError('not-visible', NOT_VISIBLE_MESSAGE)
}
