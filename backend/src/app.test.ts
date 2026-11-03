import { describe, expect, it } from 'vitest'
import { buildApp } from './app.ts'

describe('buildApp', () => {
  it('answers 404 for a route that does not exist', async () => {
    const app = buildApp()
    const response = await app.inject({ method: 'GET', url: '/no-such-route' })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
