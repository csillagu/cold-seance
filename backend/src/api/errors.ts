import { STATUS_CODES } from 'node:http'
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { ServiceError, type ServiceErrorKind } from '../service/errors.ts'

const STATUS: Record<ServiceErrorKind, number> = {
  invalid: 400,
  forbidden: 403,
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

/**
 * Translates an error thrown while answering a REST API request. A service-layer refusal keeps its
 * message, which is written for the person who made the request. A request Fastify itself refused
 * (a body that fails its schema, an unsupported content type) keeps Fastify's status and message.
 * Anything else is a fault of the backend: it is logged, and the caller learns only that it
 * happened, so no internal detail leaks out.
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
  const statusCode = 'statusCode' in error ? error.statusCode : undefined
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return reply.code(statusCode).send(errorBody(statusCode, error.message))
  }
  request.log.error({ err: error }, 'REST API request failed')
  return reply.code(500).send(errorBody(500, 'Internal Server Error'))
}
