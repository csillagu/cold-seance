import { describe, expect, it } from 'vitest'
import { missingSchemas } from './schema-guard.ts'

const ok = { 200: { type: 'object', properties: { id: { type: 'string' } } } }

describe('missingSchemas', () => {
  it('finds nothing missing on a read route with a success response schema', () => {
    expect(missingSchemas({ method: 'GET', url: '/tasks', schema: { response: ok } })).toEqual([])
  })

  it('accepts a 2xx range as the success response', () => {
    expect(
      missingSchemas({
        method: 'GET',
        url: '/tasks',
        schema: { response: { '2xx': { type: 'array' } } },
      }),
    ).toEqual([])
  })

  it('does not count an error response as the success response', () => {
    expect(
      missingSchemas({
        method: 'GET',
        url: '/tasks',
        schema: { response: { 404: { type: 'object', properties: {} } } },
      }),
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

  it.each([
    ['an empty schema', {}],
    ['an object with nothing declared', { type: 'object' }],
    ['an object open to anything', { type: 'object', additionalProperties: true }],
    ['something that is not a schema', true],
    ['null', null],
  ])('refuses %s as the success response', (_name, body) => {
    expect(
      missingSchemas({ method: 'GET', url: '/x', schema: { response: { 200: body } } }),
    ).toEqual(['a response schema for 200 that names its type'])
  })

  it.each([
    ['a shared schema', { $ref: 'task#' }],
    ['a type other than object', { type: 'null' }],
    ['an object with properties', { type: 'object', properties: {} }],
    ['a map of described values', { type: 'object', additionalProperties: { type: 'number' } }],
  ])('accepts %s as the success response', (_name, body) => {
    expect(
      missingSchemas({ method: 'GET', url: '/x', schema: { response: { 201: body } } }),
    ).toEqual([])
  })
})
