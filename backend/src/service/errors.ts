/**
 * The ways a service-layer call can refuse a request (DD-039). `not-visible` is a refusal of a
 * project the caller cannot see at all (FR-017); `forbidden`, of something their role there, or
 * their account, does not allow. The service layer throws a
 * `ServiceError`; the REST API and the MCP server translate it for their callers, so a rule that
 * refuses a change refuses it the same way through every channel (FR-115).
 */
export type ServiceErrorKind = 'invalid' | 'forbidden' | 'not-visible' | 'not-found' | 'conflict'

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
