import type { RouteOptions } from 'fastify'

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

/**
 * The schemas a REST API route must declare before it can be registered (DD-044): a response
 * schema for its success status that says what it sends, a body schema if it takes a body, and a
 * params schema if its URL has parameters. A route without them could return fields nobody
 * described and would drift from the OpenAPI description generated from the schemas, so it is
 * refused at start rather than served. A query string cannot be told apart from its absence by
 * looking at the route, so a querystring schema is the route author's duty and is not checked.
 * Answers the problems found, empty when there are none.
 */
export function missingSchemas(route: Pick<RouteOptions, 'method' | 'url' | 'schema'>): string[] {
  const schema = route.schema ?? {}
  const methods = Array.isArray(route.method) ? route.method : [route.method]
  const problems: string[] = []

  const success = Object.entries(schema.response ?? {}).filter(([status]) =>
    /^(2\d\d|2xx)$/i.test(status),
  )
  if (success.length === 0) problems.push('a response schema for its success status')
  for (const [status, body] of success) {
    if (!describesBody(body)) problems.push(`a response schema for ${status} that names its type`)
  }

  if (methods.some((method) => METHODS_WITH_BODY.has(method.toUpperCase())) && !schema.body) {
    problems.push('a body schema')
  }
  if (/(^|\/):/.test(route.url) && !schema.params) problems.push('a params schema')

  return problems
}

/**
 * Whether a response schema says what is sent: a `$ref` to a shared schema, or a `type`, and for
 * an object its properties or the schema of its values. `{}` would let anything out, and
 * `{ type: 'object' }` alone would silently send `{}`.
 */
function describesBody(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  if ('$ref' in body) return true
  if (!('type' in body)) return false
  if (body.type !== 'object') return true
  const values = 'additionalProperties' in body ? body.additionalProperties : undefined
  return 'properties' in body || (typeof values === 'object' && values !== null)
}
