import { describe, expect, it } from 'vitest'
import { missingSchemas } from './schema-guard.ts'

const ok = { 200: { type: 'object' } }

describe('missingSchemas', () => {
  it('finds nothing missing on a read route with a success response schema', () => {
    expect(missingSchemas({ method: 'GET', url: '/tasks', schema: { response: ok } })).toEqual([])
  })

  it('accepts a 2xx range as the success response', () => {
    expect(
      missingSchemas({ method: 'GET', url: '/tasks', schema: { response: { '2xx': {} } } }),
    ).toEqual([])
  })

  it('does not count an error response as the success response', () => {
    expect(
      missingSchemas({ method: 'GET', url: '/tasks', schema: { response: { 404: {} } } }),
    ).toEqual(['a response schema for its success status'])
  })

  it('names every missing schema of a route that has none', () => {
    expect(missingSchemas({ method: 'PATCH', url: '/tasks/:taskId' })).toEqual([
      'a response schema for its success status',
      'a body schema',
      'a params schema',
    ])
  })

  it.each(['POST', 'PUT', 'PATCH', 'post'])('asks %s for a body schema', (method) => {
    expect(missingSchemas({ method, url: '/tasks', schema: { response: ok } })).toEqual([
      'a body schema',
    ])
  })

  it.each(['GET', 'DELETE', 'HEAD'])('does not ask %s for a body schema', (method) => {
    expect(missingSchemas({ method, url: '/tasks', schema: { response: ok } })).toEqual([])
  })

  it('checks every method of a route registered for several', () => {
    expect(
      missingSchemas({ method: ['GET', 'POST'], url: '/tasks', schema: { response: ok } }),
    ).toEqual(['a body schema'])
  })

  it('asks for a params schema when a parameter is anywhere in the URL', () => {
    expect(missingSchemas({ method: 'GET', url: '/:id', schema: { response: ok } })).toEqual([
      'a params schema',
    ])
    expect(
      missingSchemas({
        method: 'GET',
        url: '/projects/:projectId/tasks',
        schema: { response: ok, params: {} },
      }),
    ).toEqual([])
  })

  it('does not mistake a colon inside a path segment for a parameter', () => {
    expect(missingSchemas({ method: 'GET', url: '/tasks/a:b', schema: { response: ok } })).toEqual(
      [],
    )
  })
})
