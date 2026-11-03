import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ConfigError,
  githubFunctions,
  type GitHubAppConfig,
  type GitHubFunction,
} from '../config/config.ts'
import {
  createGitHubAppTokens,
  defaultGitHubApiUrl,
  GitHubAppNotInstalledError,
  GitHubAppTokenError,
  tokenRenewalMargin,
  type GitHubAppTokensOptions,
} from './app-tokens.ts'

// --- Helpers ---------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error(`not a JSON object: ${text}`)
  return value
}

/** Awaits `promise` expecting it to reject with a `type`, and returns the error. */
async function rejection<E extends Error>(
  promise: Promise<unknown>,
  type: abstract new (...args: never[]) => E,
): Promise<E> {
  let error: unknown
  try {
    await promise
  } catch (e) {
    error = e
  }
  if (!(error instanceof type)) throw new Error(`expected a ${type.name}, got ${String(error)}`)
  return error
}

/** A port nothing listens on at the moment. */
async function closedPort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve))
  const address = probe.address()
  await new Promise((resolve) => probe.close(resolve))
  if (address === null || typeof address === 'string') throw new Error('no port')
  return address.port
}

/** Runs `create` expecting it to throw a `ConfigError`, and returns it. */
function configRefusal(create: () => unknown): ConfigError {
  let error: unknown
  try {
    create()
  } catch (e) {
    error = e
  }
  if (!(error instanceof ConfigError)) throw new Error(`expected a ConfigError: ${String(error)}`)
  return error
}

// --- Keys ------------------------------------------------------------------------------------------

interface Key {
  pem: string
  publicKey: KeyObject
}

function rsaKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { pem: privateKey.export({ type: 'pkcs1', format: 'pem' }), publicKey }
}

const keys = { a: rsaKey(), b: rsaKey(), c: rsaKey() }

function appConfig(appId: number, pem: string, file = `/run/secrets/app-${appId}.pem`) {
  return { appId, privateKeyFile: file, privateKey: pem, webhookSecret: undefined }
}

/** One App per function: 11 reads issues, 12 writes to them, 13 sets the Projects status field. */
const separateApps: Record<GitHubFunction, GitHubAppConfig> = {
  readIssues: appConfig(11, keys.a.pem),
  writeIssues: appConfig(12, keys.b.pem),
  projectsStatus: appConfig(13, keys.c.pem),
}

/** The same App, 21, for every function. */
const oneApp: Record<GitHubFunction, GitHubAppConfig> = {
  readIssues: appConfig(21, keys.a.pem),
  writeIssues: appConfig(21, keys.a.pem),
  projectsStatus: appConfig(21, keys.a.pem),
}

// --- A fake GitHub ---------------------------------------------------------------------------------

const t0 = Date.parse('2026-11-03T10:00:00Z')
let clock = t0
const now = () => clock

interface Issued {
  token: string
  appId: number
  installation: number
  repositories: unknown
  expiresAt: number
}

interface Recorded {
  method: string
  path: string
  headers: IncomingHttpHeaders
  body: unknown
  /** The App whose key signed the request, if its JWT is valid. */
  appId: number | undefined
  jwt: { header: Record<string, unknown>; payload: Record<string, unknown> } | undefined
}

type Answer = { status: number; body?: unknown; raw?: string } | 'hang' | 'stall-body'

/** What the fake GitHub knows and answers, reset before each test. */
const github = {
  /** The Apps it knows, by id, with their public keys. */
  apps: new Map<number, KeyObject>(),
  /** `appId` → `owner/name` (lowercase) → installation id. */
  installations: new Map<number, Map<string, number>>(),
  /** How long a token lives: an hour, as on GitHub. */
  tokenLifetime: 60 * 60_000,
  /** Answers a request in place of the fake's own rules, if it returns an answer. */
  override: undefined as ((path: string) => Answer | undefined) | undefined,
  requests: [] as Recorded[],
  issued: [] as Issued[],
}

function resetGitHub(): void {
  github.apps = new Map([
    [11, keys.a.publicKey],
    [12, keys.b.publicKey],
    [13, keys.c.publicKey],
    [21, keys.a.publicKey],
  ])
  // Every App is installed on octo/one and octo/two, and all but App 12 on octo/three.
  github.installations = new Map(
    [11, 12, 13, 21].map((id) => {
      const repos = new Map([
        ['octo/one', id * 100 + 1],
        ['octo/two', id * 100 + 1],
      ])
      if (id !== 12) repos.set('octo/three', id * 100 + 3)
      return [id, repos]
    }),
  )
  github.tokenLifetime = 60 * 60_000
  github.override = undefined
  github.requests = []
  github.issued = []
}

/** The App a request's JWT was signed by, checked against the fake clock as GitHub checks it. */
function verifyJwt(authorization: string | undefined) {
  const [h, p, s, ...rest] = (authorization ?? '').replace(/^Bearer /, '').split('.')
  if (h === undefined || p === undefined || s === undefined || rest.length > 0) return undefined
  const header = parseObject(Buffer.from(h, 'base64url').toString())
  const payload = parseObject(Buffer.from(p, 'base64url').toString())
  const appId = Number(payload.iss)
  const publicKey = github.apps.get(appId)
  if (header.alg !== 'RS256' || publicKey === undefined) return undefined
  if (!verify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url'))) {
    return undefined
  }
  const at = clock / 1000
  const { iat, exp } = payload
  if (typeof iat !== 'number' || typeof exp !== 'number') return undefined
  if (!(iat <= at && at < exp && exp - at <= 600)) return undefined
  return { appId, jwt: { header, payload } }
}

/** Whether `token` is one GitHub issued for `appId` on `repository` that has not expired. */
function tokenIsValid(token: string, appId: number, repository: string): boolean {
  const issued = github.issued.find((i) => i.token === token)
  const name = repository.split('/')[1]
  return (
    issued !== undefined &&
    issued.appId === appId &&
    Array.isArray(issued.repositories) &&
    issued.repositories.includes(name) &&
    github.installations.get(appId)?.get(repository) === issued.installation &&
    clock < issued.expiresAt
  )
}

let server: Server
let apiUrl: string

beforeAll(async () => {
  server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk: Buffer) => (text += chunk.toString()))
    request.on('end', () => {
      const path = request.url ?? ''
      const verified = verifyJwt(request.headers.authorization)
      const body = text === '' ? undefined : parseObject(text)
      github.requests.push({
        method: request.method ?? '',
        path,
        headers: request.headers,
        body,
        appId: verified?.appId,
        jwt: verified?.jwt,
      })
      const send = (status: number, json?: unknown, raw?: string) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(raw ?? (json === undefined ? '' : JSON.stringify(json)))
      }
      const override = github.override?.(path)
      if (override === 'hang') return
      if (override === 'stall-body') {
        // The headers and part of the body, and then nothing more.
        response.writeHead(200, { 'content-type': 'application/json' })
        response.write('{"id": ')
        return
      }
      if (override !== undefined) return send(override.status, override.body, override.raw)
      if (verified === undefined) {
        return send(401, { message: 'A JSON web token could not be decoded' })
      }
      const installations = github.installations.get(verified.appId) ?? new Map<string, number>()

      const lookup = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(path)
      if (request.method === 'GET' && lookup) {
        const id = installations.get(`${lookup[1]}/${lookup[2]}`.toLowerCase())
        return id === undefined ? send(404, { message: 'Not Found' }) : send(200, { id })
      }
      const issue = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path)
      if (request.method === 'POST' && issue) {
        const installation = Number(issue[1])
        if (![...installations.values()].includes(installation)) {
          return send(404, { message: 'Not Found' })
        }
        const token = `ghs_${verified.appId}_${installation}_${github.issued.length + 1}`
        const expiresAt = clock + github.tokenLifetime
        const repositories = body?.repositories
        github.issued.push({ token, appId: verified.appId, installation, repositories, expiresAt })
        return send(201, { token, expires_at: new Date(expiresAt).toISOString() })
      }
      send(404, { message: 'Not Found' })
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  apiUrl = `http://127.0.0.1:${address.port}`
})

afterAll(async () => {
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  clock = t0
  resetGitHub()
})

function tokens(
  apps: Partial<Record<GitHubFunction, GitHubAppConfig>> = separateApps,
  options: GitHubAppTokensOptions = {},
) {
  return createGitHubAppTokens(apps, { apiUrl, now, ...options })
}

const one = { owner: 'octo', name: 'one' }
const two = { owner: 'octo', name: 'two' }
const three = { owner: 'octo', name: 'three' }

// --- Tests -----------------------------------------------------------------------------------------

describe('GitHub App tokens (SC-108)', () => {
  describe('returns a valid token for every function and repository its App is installed on', () => {
    it('with one App per function, gives each function a token of its own App', async () => {
      const t = tokens(separateApps)
      for (const fn of githubFunctions) {
        for (const repo of [one, two]) {
          const token = await t.token(fn, repo)
          expect(tokenIsValid(token, separateApps[fn].appId, `octo/${repo.name}`)).toBe(true)
        }
      }
      expect(tokenIsValid(await t.token('readIssues', three), 11, 'octo/three')).toBe(true)
      expect(tokenIsValid(await t.token('projectsStatus', three), 13, 'octo/three')).toBe(true)
      // Each function's requests were signed by its own App's key.
      expect(new Set(github.requests.map((r) => r.appId))).toEqual(new Set([11, 12, 13]))
    })

    it('with one App for all functions, gives every function the same token', async () => {
      const t = tokens(oneApp)
      const got = await Promise.all(githubFunctions.map((fn) => t.token(fn, one)))
      expect(new Set(got).size).toBe(1)
      expect(tokenIsValid(got[0] ?? '', 21, 'octo/one')).toBe(true)
      expect(github.issued).toHaveLength(1)
      expect(github.requests.every((r) => r.appId === 21)).toBe(true)
    })

    it('keeps apart Apps that share an id but not a key', async () => {
      const t = tokens({ ...oneApp, projectsStatus: appConfig(21, keys.b.pem) })
      await t.token('readIssues', one)
      await t.token('writeIssues', one)
      expect(github.issued).toHaveLength(1)
      // The other key is not one GitHub knows for App 21, so its own request is made, and refused.
      await rejection(t.token('projectsStatus', one), GitHubAppTokenError)
      expect(github.requests).toHaveLength(3)
    })

    it('obtains a token for each repository, scoped to that repository', async () => {
      const t = tokens()
      const first = await t.token('writeIssues', one)
      const second = await t.token('writeIssues', two)
      expect(first).not.toBe(second)
      expect(tokenIsValid(first, 12, 'octo/two')).toBe(false)
      const posts = github.requests.filter((r) => r.method === 'POST')
      expect(posts.map((r) => r.body)).toEqual([
        { repositories: ['one'] },
        { repositories: ['two'] },
      ])
    })
  })

  describe('holds only the Apps of the functions given an App (DD-060)', () => {
    // Writing to issues is given a personal access token: the configuration leaves it out of `apps`.
    const mixed = {
      readIssues: separateApps.readIssues,
      projectsStatus: separateApps.projectsStatus,
    }

    it('returns a token of its own App for each function given one', async () => {
      const t = tokens(mixed)
      expect(tokenIsValid(await t.token('readIssues', one), 11, 'octo/one')).toBe(true)
      expect(tokenIsValid(await t.token('projectsStatus', one), 13, 'octo/one')).toBe(true)
      expect(new Set(github.requests.map((r) => r.appId))).toEqual(new Set([11, 13]))
    })

    it('refuses a function given no App, without calling GitHub', async () => {
      const t = tokens(mixed)
      const error = await rejection(t.token('writeIssues', one), TypeError)
      expect(error.message).toBe(
        'The GitHub function for writing to issues is not given a GitHub App',
      )
      expect(github.requests).toEqual([])
    })

    it('holds no App and calls GitHub for none when every function is given a token', async () => {
      const t = tokens({})
      for (const fn of githubFunctions) await rejection(t.token(fn, one), TypeError)
      expect(github.requests).toEqual([])
    })
  })

  describe("signs requests with the App's private key", () => {
    it('as an RS256 JWT issued by the App, backdated a minute and expiring nine minutes on', async () => {
      await tokens().token('projectsStatus', one)
      const [lookup, issue] = github.requests
      expect(lookup).toMatchObject({
        method: 'GET',
        path: '/repos/octo/one/installation',
        appId: 13,
      })
      expect(issue).toMatchObject({
        method: 'POST',
        path: '/app/installations/1301/access_tokens',
        appId: 13,
      })
      expect(lookup?.jwt).toEqual({
        header: { alg: 'RS256', typ: 'JWT' },
        payload: { iss: '13', iat: t0 / 1000 - 60, exp: t0 / 1000 + 540 },
      })
    })

    it("sends GitHub's API version, media type and a user agent", async () => {
      await tokens().token('readIssues', one)
      expect(github.requests[1]?.headers).toMatchObject({
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'cold-seance',
        'content-type': 'application/json',
      })
    })

    it('re-signs the JWT a minute before it expires, and not before', async () => {
      const t = tokens()
      await t.token('readIssues', one)
      clock = t0 + 8 * 60_000 - 1
      await t.token('readIssues', two)
      expect(github.requests[2]?.jwt).toEqual(github.requests[0]?.jwt)
      clock = t0 + 8 * 60_000
      await t.token('readIssues', three)
      expect(github.requests[4]?.jwt?.payload).toMatchObject({ iat: (clock - 60_000) / 1000 })
    })

    it('calls api.github.com unless told otherwise, and a given URL without its trailing slashes', async () => {
      const urls: string[] = []
      const fetch: typeof globalThis.fetch = (input) => {
        urls.push(input instanceof Request ? input.url : input.toString())
        return Promise.resolve(new Response('{}', { status: 500 }))
      }
      const ghe = 'https://ghe.example/api/v3//'
      await rejection(
        createGitHubAppTokens(separateApps, { fetch }).token('readIssues', one),
        GitHubAppTokenError,
      )
      await rejection(
        createGitHubAppTokens(separateApps, { fetch, apiUrl: ghe }).token('readIssues', one),
        GitHubAppTokenError,
      )
      expect(defaultGitHubApiUrl).toBe('https://api.github.com')
      expect(urls).toEqual([
        'https://api.github.com/repos/octo/one/installation',
        'https://ghe.example/api/v3/repos/octo/one/installation',
      ])
    })
  })

  describe('keeps each token until shortly before it expires', () => {
    it('answers later calls with the kept token, without asking GitHub', async () => {
      const t = tokens()
      const first = await t.token('writeIssues', one)
      const requests = github.requests.length
      clock = t0 + github.tokenLifetime - tokenRenewalMargin - 1
      expect(await t.token('writeIssues', one)).toBe(first)
      // GitHub treats names without regard to case.
      expect(await t.token('writeIssues', { owner: 'Octo', name: 'ONE' })).toBe(first)
      expect(github.requests).toHaveLength(requests)
      expect(tokenIsValid(first, 12, 'octo/one')).toBe(true)
    })

    it(`obtains a new token ${tokenRenewalMargin / 60_000} minutes before the kept one expires`, async () => {
      const t = tokens()
      const first = await t.token('writeIssues', one)
      clock = t0 + github.tokenLifetime - tokenRenewalMargin
      const second = await t.token('writeIssues', one)
      expect(second).not.toBe(first)
      expect(tokenIsValid(second, 12, 'octo/one')).toBe(true)
      expect(github.issued).toHaveLength(2)
    })

    it('does not keep a token GitHub gives with less time left than the margin', async () => {
      github.tokenLifetime = tokenRenewalMargin - 1000
      const t = tokens()
      const first = await t.token('readIssues', one)
      expect(await t.token('readIssues', one)).not.toBe(first)
    })

    it('lets calls that arrive together wait for one token', async () => {
      const t = tokens(oneApp)
      const got = await Promise.all([
        t.token('readIssues', one),
        t.token('writeIssues', one),
        t.token('readIssues', one),
      ])
      expect(new Set(got).size).toBe(1)
      expect(github.requests).toHaveLength(2)
    })

    it('keeps the tokens of separate Apps apart', async () => {
      const t = tokens()
      const read = await t.token('readIssues', one)
      const write = await t.token('writeIssues', one)
      expect(read).not.toBe(write)
      expect(tokenIsValid(read, 11, 'octo/one')).toBe(true)
      expect(tokenIsValid(write, 12, 'octo/one')).toBe(true)
    })
  })

  describe("reports which function's App is not installed on a repository", () => {
    it('names the function, its App and the repository', async () => {
      const error = await rejection(
        tokens().token('writeIssues', three),
        GitHubAppNotInstalledError,
      )
      expect(error).toMatchObject({ function: 'writeIssues', appId: 12, repository: 'octo/three' })
      expect(error.message).toBe(
        'The GitHub App for writing to issues (App 12) is not installed on octo/three, or the repository does not exist',
      )
    })

    it('answers each function in its own terms when they share one App', async () => {
      github.installations.get(21)?.delete('octo/three')
      const t = tokens(oneApp)
      const errors = await Promise.all(
        githubFunctions.map((fn) => rejection(t.token(fn, three), GitHubAppNotInstalledError)),
      )
      expect(errors.map((e) => e.function)).toEqual([...githubFunctions])
      expect(errors.map((e) => e.message.split(' is not')[0])).toEqual([
        'The GitHub App for reading issues (App 21)',
        'The GitHub App for writing to issues (App 21)',
        'The GitHub App for the Projects status field (App 21)',
      ])
    })

    it('reports the App as not installed if it is removed between the lookup and the token', async () => {
      github.override = (path) =>
        path.endsWith('/access_tokens')
          ? { status: 404, body: { message: 'Not Found' } }
          : undefined
      const error = await rejection(tokens().token('readIssues', one), GitHubAppNotInstalledError)
      expect(error.function).toBe('readIssues')
    })

    it('finds the App once it is installed, as a failure is not kept', async () => {
      const t = tokens()
      await rejection(t.token('writeIssues', three), GitHubAppNotInstalledError)
      github.installations.get(12)?.set('octo/three', 1203)
      expect(tokenIsValid(await t.token('writeIssues', three), 12, 'octo/three')).toBe(true)
    })
  })

  describe('reports a token GitHub refuses or does not give', () => {
    it.each([
      ['the installation lookup', '/installation', 401, 'A JSON web token could not be decoded'],
      ['the token', '/access_tokens', 403, 'This installation has been suspended'],
      ['the token', '/access_tokens', 422, 'There is at least one repository that does not exist'],
    ])(
      'names the status and GitHub message when %s is refused (%i)',
      async (_what, suffix, status, message) => {
        github.override = (path) =>
          path.endsWith(suffix) ? { status, body: { message } } : undefined
        const error = await rejection(tokens().token('projectsStatus', one), GitHubAppTokenError)
        expect(error).toMatchObject({
          function: 'projectsStatus',
          appId: 13,
          repository: 'octo/one',
          status,
        })
        expect(error.message).toBe(
          `The token of the GitHub App for the Projects status field (App 13) on octo/one cannot be obtained: GitHub answered ${status} (${message})`,
        )
      },
    )

    it('names the status alone when the answer is not JSON', async () => {
      github.override = () => ({ status: 502, raw: '<html>Bad gateway</html>' })
      const error = await rejection(tokens().token('readIssues', one), GitHubAppTokenError)
      expect(error.message).toMatch(/cannot be obtained: GitHub answered 502$/)
      expect(error.status).toBe(502)
    })

    const later = '2026-11-03T11:00:00Z'
    it.each([
      ['an installation without an id', '/installation', 200, { account: 'octo' }],
      ['an installation id that is not a number', '/installation', 200, { id: '7' }],
      ['a token answer without a token', '/access_tokens', 201, { expires_at: later }],
      ['an empty token', '/access_tokens', 201, { token: '', expires_at: later }],
      ['a token without an expiry', '/access_tokens', 201, { token: 'ghs_x' }],
      ['an expiry that is not a date', '/access_tokens', 201, { token: 'ghs_x', expires_at: 'x' }],
      ['an answer that is not JSON', '/access_tokens', 201, undefined],
    ])('refuses %s', async (_what, suffix, status, body) => {
      github.override = (path) =>
        path.endsWith(suffix)
          ? { status, body, raw: body === undefined ? 'ghs_x' : undefined }
          : undefined
      const error = await rejection(tokens().token('readIssues', one), GitHubAppTokenError)
      expect(error.status).toBeUndefined()
      expect(error.message).toMatch(
        suffix === '/installation'
          ? /: GitHub named no installation$/
          : /: GitHub answered without a token$/,
      )
    })

    it('reports GitHub as unreachable when a body is cut short by the timeout', async () => {
      github.override = (path) => (path.endsWith('/installation') ? 'stall-body' : undefined)
      const t = tokens(separateApps, { requestTimeout: 100 })
      const error = await rejection(t.token('readIssues', one), GitHubAppTokenError)
      expect(error.message).toMatch(/GitHub cannot be reached: .*(time|abort)/i)
    })

    it('names the cause of a failed connection', async () => {
      const port = await closedPort()
      const t = createGitHubAppTokens(separateApps, { apiUrl: `http://127.0.0.1:${port}`, now })
      const error = await rejection(t.token('readIssues', one), GitHubAppTokenError)
      expect(error.message).toMatch(
        /^The token of the GitHub App for reading issues \(App 11\) on octo\/one cannot be obtained: GitHub cannot be reached: fetch failed: connect ECONNREFUSED /,
      )
      expect(error.status).toBeUndefined()
    })

    it('gives up a request that takes longer than the timeout', async () => {
      github.override = () => 'hang'
      const t = tokens(separateApps, { requestTimeout: 50 })
      const error = await rejection(t.token('readIssues', one), GitHubAppTokenError)
      expect(error.message).toMatch(/GitHub cannot be reached: .*time/i)
    })

    it('reports a failure that is not an Error', async () => {
      // A plain string on purpose: a fetch may reject with anything.
      const fetch: typeof globalThis.fetch = () => Promise.reject('offline')
      const t = createGitHubAppTokens(separateApps, { fetch })
      const error = await rejection(t.token('readIssues', one), GitHubAppTokenError)
      expect(error.message).toMatch(/GitHub cannot be reached: offline$/)
    })

    it('keeps no failure, so the next call asks GitHub again', async () => {
      github.override = () => ({ status: 500, body: { message: 'Server Error' } })
      const t = tokens()
      await rejection(t.token('readIssues', one), GitHubAppTokenError)
      github.override = undefined
      expect(tokenIsValid(await t.token('readIssues', one), 11, 'octo/one')).toBe(true)
    })

    it('never puts the private key or the JWT in a message', async () => {
      github.override = () => ({ status: 401, body: { message: 'Bad credentials' } })
      const error = await rejection(tokens().token('readIssues', one), GitHubAppTokenError)
      const jwt = (github.requests[0]?.headers.authorization ?? '').slice('Bearer '.length)
      expect(jwt).not.toBe('')
      expect(error.message).not.toContain(jwt)
      expect(error.message).not.toContain('PRIVATE KEY')
    })
  })

  describe('refuses a repository name GitHub would not accept', () => {
    it.each([
      { owner: 'octo', name: '..' },
      { owner: 'octo', name: '.' },
      { owner: '..', name: 'one' },
      { owner: 'octo/one', name: 'issues' },
      { owner: 'octo', name: 'one/../../app' },
      { owner: 'octo', name: 'one?x=1' },
      { owner: '', name: 'one' },
      { owner: 'octo', name: '' },
      { owner: '-octo', name: 'one' },
      { owner: 'o'.repeat(40), name: 'one' },
      { owner: 'octo', name: 'n'.repeat(101) },
    ])('refuses $owner/$name without calling GitHub', async (repository) => {
      const error = await rejection(tokens().token('readIssues', repository), TypeError)
      expect(error.message).toBe(
        `${repository.owner}/${repository.name} is not a GitHub repository name`,
      )
      expect(github.requests).toHaveLength(0)
    })

    it('accepts the names GitHub allows', async () => {
      github.installations.get(11)?.set('a-b/x.y_z-1', 1109)
      github.installations.get(11)?.set(`${'o'.repeat(39)}/${'n'.repeat(100)}`, 1110)
      const t = tokens()
      expect(await t.token('readIssues', { owner: 'a-b', name: 'x.y_z-1' })).toMatch(/^ghs_/)
      expect(await t.token('readIssues', { owner: 'o'.repeat(39), name: 'n'.repeat(100) })).toMatch(
        /^ghs_/,
      )
      expect(github.requests[0]?.path).toBe('/repos/a-b/x.y_z-1/installation')
    })
  })

  describe('refuses a key that is not an RSA private key, naming the setting', () => {
    const ecKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    })
    const publicPem = keys.a.publicKey.export({ type: 'spki', format: 'pem' })

    it.each([
      ['text that is not a key', 'key-readIssues'],
      ['an EC private key', ecKey],
      ['a public key', publicPem],
      ['an empty file', ''],
    ])('refuses %s', (_what, privateKey) => {
      const apps = { ...separateApps, writeIssues: { ...separateApps.writeIssues, privateKey } }
      expect(configRefusal(() => tokens(apps)).problems).toEqual([
        'github.apps.writeIssues.privateKeyFile (COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_PRIVATE_KEY_FILE): the key file /run/secrets/app-12.pem does not hold an RSA private key',
      ])
    })

    it('names every function whose key is refused, a shared one included', () => {
      const bad = appConfig(21, 'not a key', '/run/secrets/shared.pem')
      const apps = {
        readIssues: bad,
        writeIssues: bad,
        projectsStatus: separateApps.projectsStatus,
      }
      expect(configRefusal(() => tokens(apps)).problems).toEqual([
        'github.apps.readIssues.privateKeyFile (COLD_SEANCE_GITHUB_APPS_READ_ISSUES_PRIVATE_KEY_FILE): the key file /run/secrets/shared.pem does not hold an RSA private key',
        'github.apps.writeIssues.privateKeyFile (COLD_SEANCE_GITHUB_APPS_WRITE_ISSUES_PRIVATE_KEY_FILE): the key file /run/secrets/shared.pem does not hold an RSA private key',
      ])
    })

    it('accepts an RSA key in PKCS#8 as well as PKCS#1', async () => {
      const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
      github.apps.set(11, publicKey)
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' })
      const t = tokens({ ...separateApps, readIssues: appConfig(11, pem) })
      expect(tokenIsValid(await t.token('readIssues', one), 11, 'octo/one')).toBe(true)
    })
  })
})
