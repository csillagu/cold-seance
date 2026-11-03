import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Authenticator } from './api/caller.ts'
import { buildApp } from './app.ts'
import { defaultFrontendDir, hasFrontend } from './frontend.ts'

// The backend serves the built frontend (SC-028): its files as they are, its index.html for the
// single-page application's own routes, and nothing that belongs to the REST API.

const indexHtml = '<!doctype html><title>cold-seance</title><div id="root"></div>'
const appJs = 'console.log("the frontend")'

let root: string
let dist: string
let app: FastifyInstance | undefined

/** Recognises one fixed header, standing in for the authenticators of later SCs. */
const byHeader: Authenticator = async (request) =>
  request.headers.authorization === 'Bearer alice'
    ? { accountId: 'alice', channel: 'rest-api' }
    : undefined

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'cold-seance-frontend-'))
  dist = join(root, 'dist')
  mkdirSync(join(dist, 'assets'), { recursive: true })
  writeFileSync(join(dist, 'index.html'), indexHtml)
  writeFileSync(join(dist, 'assets', 'index-abc123.js'), appJs)
  // Next to the frontend, not in it: it must never be served.
  writeFileSync(join(root, 'secret.txt'), 'not for the browser')
})

afterEach(async () => {
  await app?.close()
  app = undefined
  rmSync(root, { recursive: true, force: true })
})

function withFrontend(): FastifyInstance {
  app = buildApp({}, { authenticators: [byHeader] }, { frontendDir: dist })
  return app
}

describe('serving the built frontend', () => {
  it('answers / with the frontend’s index.html', async () => {
    const response = await withFrontend().inject({ method: 'GET', url: '/' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/^text\/html/)
    expect(response.body).toBe(indexHtml)
  })

  it('serves the frontend’s files as they are', async () => {
    const response = await withFrontend().inject({ method: 'GET', url: '/assets/index-abc123.js' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/javascript/)
    expect(response.body).toBe(appJs)
  })

  it.each(['/projects/42', '/projects/42/gantt?from=2026-11-01', '/index.html'])(
    'answers %s, a route of the single-page application or its page, with index.html',
    async (url) => {
      const response = await withFrontend().inject({ method: 'GET', url })
      expect(response.statusCode).toBe(200)
      expect(response.body).toBe(indexHtml)
    },
  )

  it('answers HEAD on such a route without a body', async () => {
    const response = await withFrontend().inject({ method: 'HEAD', url: '/projects/42' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toMatch(/^text\/html/)
    expect(response.body).toBe('')
  })

  it.each(['POST', 'PUT', 'DELETE'] as const)(
    'answers %s outside the API with 404 in the API’s error shape',
    async (method) => {
      const response = await withFrontend().inject({ method, url: '/projects/42' })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not Found' })
    },
  )

  it.each(['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt'])(
    'never serves a file from outside the frontend: %s is not found',
    async (url) => {
      const response = await withFrontend().inject({ method: 'GET', url })
      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not Found' })
    },
  )

  it.each(['/assets/index-old999.js', '/favicon.ico', '/.env'])(
    'answers a missing file, %s, with 404 rather than index.html',
    async (url) => {
      const response = await withFrontend().inject({ method: 'GET', url })
      expect(response.statusCode).toBe(404)
      expect(response.body).not.toContain('<!doctype html>')
    },
  )

  it.each(['/api', '/api/', '/api/no-such-route', '/api/openapi.json'])(
    'leaves %s to the REST API’s own authentication: 401, not the frontend',
    async (url) => {
      const response = await withFrontend().inject({ method: 'GET', url })
      expect(response.statusCode).toBe(401)
      expect(response.body).not.toContain('<!doctype html>')
    },
  )

  it('leaves the REST API its own 404 for an authenticated caller', async () => {
    const response = await withFrontend().inject({
      method: 'GET',
      url: '/api/no-such-route',
      headers: { authorization: 'Bearer alice' },
    })
    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ statusCode: 404, error: 'Not Found', message: 'Not Found' })
  })

  it('serves the API’s own routes to an authenticated caller', async () => {
    const response = await withFrontend().inject({
      method: 'GET',
      url: '/api/openapi.json',
      headers: { authorization: 'Bearer alice' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toHaveProperty('openapi')
  })
})

describe('hasFrontend', () => {
  it('is true for a folder holding index.html and false otherwise', () => {
    expect(hasFrontend(dist)).toBe(true)
    expect(hasFrontend(root)).toBe(false)
    expect(hasFrontend(join(root, 'no-such-folder'))).toBe(false)
  })
})

describe('defaultFrontendDir', () => {
  it('is the frontend package’s build output, beside the backend', () => {
    expect(defaultFrontendDir).toBe(join(import.meta.dirname, '..', '..', 'frontend', 'dist'))
  })
})
