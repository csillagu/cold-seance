import type { RouteOptions } from 'fastify'

const METHODS_WITH_BODY = new Set(['POST', 'PUT', 'PATCH'])

/**
 * The schemas a REST API route must declare before it can be registered (DD-044): a response
 * schema for its success status, a body schema if it takes a body, and a params schema if its URL
 * has parameters. A route without them could return fields nobody described and would drift from
 * the OpenAPI description generated from the schemas, so it is refused at start rather than
 * served. Answers the problems found, empty when there are none.
 */
export function missingSchemas(route: Pick<RouteOptions, 'method' | 'url' | 'schema'>): string[] {
  const schema = route.schema ?? {}
  const methods = Array.isArray(route.method) ? route.method : [route.method]
  const problems: string[] = []

  const hasSuccess = Object.keys(schema.response ?? {}).some((status) =>
    /^(2\d\d|2xx)$/i.test(status),
  )
  if (!hasSuccess) problems.push('a response schema for its success status')

  if (methods.some((method) => METHODS_WITH_BODY.has(method.toUpperCase())) && !schema.body) {
    problems.push('a body schema')
  }
  if (/(^|\/):/.test(route.url) && !schema.params) problems.push('a params schema')

  return problems
}
