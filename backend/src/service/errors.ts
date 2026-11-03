/**
 * The ways a service-layer call can refuse a request (DD-039). The service layer throws a
 * `ServiceError`; the REST API and the MCP server translate it for their callers, so a rule that
 * refuses a change refuses it the same way through every channel (FR-115).
 */
export type ServiceErrorKind = 'invalid' | 'forbidden' | 'not-found' | 'conflict'

export class ServiceError extends Error {
  readonly kind: ServiceErrorKind

  constructor(kind: ServiceErrorKind, message: string) {
    super(message)
    this.name = 'ServiceError'
    this.kind = kind
  }
}
