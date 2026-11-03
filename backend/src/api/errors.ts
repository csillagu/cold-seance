import { STATUS_CODES } from 'node:http'
import { DrizzleQueryError } from 'drizzle-orm'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ServiceError, type ServiceErrorKind } from '../service/errors.ts'

const STATUS: Record<ServiceErrorKind, number> = {
  unauthenticated: 401,
  invalid: 400,
  forbidden: 403,
  // Not 404: the answer must not suggest that the project might not exist (FR-017).
  'not-visible': 403,
  'not-found': 404,
  conflict: 409,
}

/** The body of every REST API error response, in the shape Fastify uses for its own errors. */
export interface ApiErrorBody {
  statusCode: number
  error: string
  message: string
}

export function errorBody(statusCode: number, message: string): ApiErrorBody {
  return { statusCode, error: STATUS_CODES[statusCode] ?? 'Error', message }
}

/** Thrown when no authenticator recognises the caller of a REST API request. */
export class UnauthenticatedError extends Error {
  constructor() {
    super('Authentication required')
    this.name = 'UnauthenticatedError'
  }
}

/**
 * Translates an error thrown while answering a REST API request. A service-layer refusal keeps its
 * message, which is written for the person who made the request. A request Fastify itself refused
 * (a body that fails its schema, an unsupported content type) keeps Fastify's status and message.
 * Anything else is a fault of the backend, even if it carries an HTTP status of its own: it is
 * logged, and the caller learns only that it happened, so no internal detail leaks out.
 */
export function handleApiError(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ServiceError) {
    const statusCode = STATUS[error.kind]
    return reply.code(statusCode).send(errorBody(statusCode, error.message))
  }
  if (error instanceof UnauthenticatedError) {
    return reply.code(401).send(errorBody(401, error.message))
  }
  const statusCode = isFastifyClientError(error) ? error.statusCode : undefined
  if (statusCode !== undefined) {
    return reply.code(statusCode).send(errorBody(statusCode, error.message))
  }
  request.log.error({ err: withoutQueryParams(error) }, 'REST API request failed')
  return reply.code(500).send(errorBody(500, 'Internal Server Error'))
}

/**
 * The error as it may be logged. A failed database query carries its parameters, in its message
 * and its stack too, and those can be secrets such as a password's hash (DD-056); the log gets the
 * query, its cause and where it failed, but not the values it was sent with.
 */
export function withoutQueryParams(error: Error): Error {
  if (!(error instanceof DrizzleQueryError)) return error
  const safe = new Error(`Failed query: ${error.query}`, { cause: error.cause })
  safe.name = 'DrizzleQueryError'
  const frames = String(error.stack).indexOf('\n    at ')
  safe.stack = `${safe.name}: ${safe.message}${frames === -1 ? '' : String(error.stack).slice(frames)}`
  return safe
}

/** An error Fastify raised itself for a request it would not take, with a 4xx status. */
function isFastifyClientError(
  error: FastifyError | Error,
): error is FastifyError & { statusCode: number } {
  if (!('statusCode' in error) || typeof error.statusCode !== 'number') return false
  const fromFastify =
    error.validation !== undefined ||
    (typeof error.code === 'string' && error.code.startsWith('FST_'))
  return fromFastify && error.statusCode >= 400 && error.statusCode < 500
}
