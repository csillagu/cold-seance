import { DrizzleQueryError } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app.ts'
import { errorBody, withoutQueryParams } from './errors.ts'

describe('errorBody', () => {
  it('names the status as HTTP does', () => {
    expect(errorBody(403, 'No')).toEqual({ statusCode: 403, error: 'Forbidden', message: 'No' })
  })

  it('falls back to a plain name for a status HTTP does not name', () => {
    expect(errorBody(499, 'Odd')).toEqual({ statusCode: 499, error: 'Error', message: 'Odd' })
  })
})

describe('withoutQueryParams', () => {
  const query = 'insert into "accounts" ("username", "password_hash") values ($1, $2)'
  const failed = () =>
    new DrizzleQueryError(query, ['erin', '$argon2id$v=19$secret-hash'], new Error('timeout'))

  it("keeps a failed query's text, cause and stack, but not its parameters", () => {
    const safe = withoutQueryParams(failed())
    expect(safe.message).toBe(`Failed query: ${query}`)
    expect(safe.name).toBe('DrizzleQueryError')
    expect(safe.cause).toEqual(new Error('timeout'))
    expect(safe.stack).toMatch(/^DrizzleQueryError: Failed query: .*\n {4}at /)
    expect(`${safe.message}${safe.stack}${JSON.stringify(Object.entries(safe))}`).not.toContain(
      'secret-hash',
    )
  })

  it('keeps the message alone for an error without a stack', () => {
    const error = failed()
    error.stack = undefined
    expect(withoutQueryParams(error).stack).toBe(`DrizzleQueryError: Failed query: ${query}`)
  })

  it('leaves any other error as it is', () => {
    const error = new Error('something else')
    expect(withoutQueryParams(error)).toBe(error)
  })

  it('keeps the parameters of a failed query out of the REST API log', async () => {
    const logged: string[] = []
    const app = buildApp(
      { logger: { level: 'error', stream: { write: (line: string) => logged.push(line) } } },
      {
        authenticators: [async () => ({ accountId: 'root', channel: 'rest-api' })],
        groups: [
          {
            prefix: '/q',
            routes: async (g) => {
              g.get(
                '/',
                { schema: { response: { 200: { type: 'object', properties: {} } } } },
                () => {
                  throw failed()
                },
              )
            },
          },
        ],
      },
    )
    try {
      const response = await app.inject({ method: 'GET', url: '/api/q' })
      expect(response.statusCode).toBe(500)
      expect(logged.join('')).toContain('Failed query: insert into')
      expect(logged.join('')).not.toContain('secret-hash')
    } finally {
      await app.close()
    }
  })
})
