import { generateKeyPairSync, verify, type KeyObject } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  ConfigError,
  githubFunctions,
  loadConfig,
  type GitHubAppConfig,
  type GitHubFunction,
} from '../config/config.ts'
import {
  createGitHubClient,
  GitHubRequestError,
  GitHubTokenRefusedError,
  GitHubUnreachableError,
  type GitHubClientOptions,
} from './client.ts'

// --- Helpers ---------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`not an object: ${JSON.stringify(value)}`)
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

// --- Apps and tokens -------------------------------------------------------------------------------

function rsaKey(): { pem: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { pem: privateKey.export({ type: 'pkcs1', format: 'pem' }), publicKey }
}

const keys = { a: rsaKey(), b: rsaKey(), c: rsaKey() }

function appConfig(appId: number, pem: string): GitHubAppConfig {
  return {
    appId,
    privateKeyFile: `/run/secrets/app-${appId}.pem`,
    privateKey: pem,
    webhookSecret: undefined,
  }
}

/** The Apps the fake GitHub knows, by id: their key and the name their changes appear under. */
const knownApps = new Map([
  [11, { key: keys.a, slug: 'reader' }],
  [12, { key: keys.b, slug: 'writer' }],
  [13, { key: keys.c, slug: 'projects' }],
  [21, { key: keys.a, slug: 'all' }],
  [260, { key: keys.c, slug: 'tc-app' }],
])

const app = {
  reader: appConfig(11, keys.a.pem),
  writer: appConfig(12, keys.b.pem),
  projects: appConfig(13, keys.c.pem),
  all: appConfig(21, keys.a.pem),
  tc: appConfig(260, keys.c.pem),
}

/** Personal access tokens, by value: the account that owns them. */
const pat = {
  bot: 'github_pat_bot_0123456789',
  carol: 'ghp_carol_0123456789',
  dave: 'ghp_dave_0123456789',
  tcBot: 'ghp_tcBotToken0123456789',
}

// --- A fake GitHub ---------------------------------------------------------------------------------

type Credential =
  { kind: 'app'; appId: number; repository: string } | { kind: 'token'; account: string }

interface Issue {
  number: number
  title: string
  state: 'open' | 'closed'
  state_reason: string | null
  user: { login: string }
}

interface Recorded {
  method: string
  path: string
  /** Who the request was made as, if GitHub accepted its credential. */
  as: string | undefined
  body: unknown
}

type Override =
  { status: number; body?: unknown; raw?: string; headers?: Record<string, string> } | 'hang'

const github = {
  /** `appId` → the repositories (lowercase `owner/name`) it is installed on. */
  installations: new Map<number, Set<string>>(),
  /** Each token's account, the repositories it reaches (`*` for all), and whether it may write. */
  tokens: new Map<string, { account: string; reaches: Set<string>; write: boolean }>(),
  revoked: new Set<string>(),
  /** The repositories that exist, with their issues. */
  repositories: new Map<string, Issue[]>(),
  /** The Projects status field of each project item, by item id. */
  status: new Map<string, string>(),
  installationTokens: new Map<string, { appId: number; repository: string }>(),
  override: undefined as ((method: string, path: string) => Override | undefined) | undefined,
  requests: [] as Recorded[],
  perPage: 2,
}

function resetGitHub(): void {
  github.installations = new Map([
    [11, new Set(['octo/one', 'octo/two'])],
    [12, new Set(['octo/one', 'octo/two'])],
    [13, new Set(['octo/one', 'octo/two'])],
    [21, new Set(['octo/one', 'octo/two'])],
    [260, new Set(['tc/tc-repo'])],
  ])
  github.tokens = new Map([
    [pat.bot, { account: 'bot', reaches: new Set(['*']), write: true }],
    [pat.carol, { account: 'carol', reaches: new Set(['octo/one']), write: true }],
    [pat.dave, { account: 'dave', reaches: new Set(['*']), write: false }],
    [pat.tcBot, { account: 'tc-bot', reaches: new Set(['tc/tc-repo']), write: true }],
  ])
  github.revoked = new Set()
  github.repositories = new Map([
    ['octo/one', []],
    ['octo/two', []],
    ['octo/private', []],
    ['tc/tc-repo', []],
  ])
  github.status = new Map([['PVTI_1', 'Todo']])
  github.installationTokens = new Map()
  github.override = undefined
  github.requests = []
  github.perPage = 2
}

/** The App a JWT was signed by, if its signature holds. */
function jwtApp(token: string): number | undefined {
  const [h, p, s] = token.split('.')
  if (h === undefined || p === undefined || s === undefined) return undefined
  const appId = Number(record(JSON.parse(Buffer.from(p, 'base64url').toString())).iss)
  const known = knownApps.get(appId)
  if (known === undefined) return undefined
  const ok = verify(
    'sha256',
    Buffer.from(`${h}.${p}`),
    known.key.publicKey,
    Buffer.from(s, 'base64url'),
  )
  return ok ? appId : undefined
}

function credentialOf(authorization: string | undefined): Credential | undefined {
  const token = (authorization ?? '').replace(/^Bearer /, '')
  const installation = github.installationTokens.get(token)
  if (installation !== undefined) return { kind: 'app', ...installation }
  const owner = github.tokens.get(token)
  if (owner !== undefined && !github.revoked.has(token))
    return { kind: 'token', account: owner.account }
  return undefined
}

function nameOf(credential: Credential): string {
  return credential.kind === 'app'
    ? `${knownApps.get(credential.appId)?.slug}[bot]`
    : credential.account
}

/** Whether the credential is shown the repository, and may write to it. */
function access(credential: Credential, token: string, repository: string) {
  if (!github.repositories.has(repository)) return { shown: false, write: false }
  if (credential.kind === 'app') {
    const shown = credential.repository === repository
    return { shown, write: shown }
  }
  const owner = github.tokens.get(token)
  const shown = owner !== undefined && (owner.reaches.has('*') || owner.reaches.has(repository))
  return { shown, write: shown && owner.write }
}

let server: Server
let apiUrl: string

beforeAll(async () => {
  server = createServer((request, response) => {
    let text = ''
    request.on('data', (chunk: Buffer) => (text += chunk.toString()))
    request.on('end', () => {
      const method = request.method ?? ''
      const url = new URL(request.url ?? '', 'http://github.test')
      const path = url.pathname
      const body: unknown = text === '' ? undefined : JSON.parse(text)
      const token = (request.headers.authorization ?? '').replace(/^Bearer /, '')
      const send = (
        status: number,
        json?: unknown,
        headers: Record<string, string> = {},
        raw?: string,
      ) => {
        response.writeHead(status, { 'content-type': 'application/json', ...headers })
        response.end(raw ?? (json === undefined ? '' : JSON.stringify(json)))
      }

      // The App's own requests, signed with its key (SC-108).
      const appId = jwtApp(token)
      const lookup = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(path)
      if (appId !== undefined && method === 'GET' && lookup !== null) {
        const repository = `${lookup[1]}/${lookup[2]}`.toLowerCase()
        github.requests.push({ method, path, as: `app ${appId}`, body })
        return github.installations.get(appId)?.has(repository) === true
          ? send(200, { id: appId * 1000 })
          : send(404, { message: 'Not Found' })
      }
      const issue = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path)
      if (appId !== undefined && method === 'POST' && issue !== null) {
        const names = record(body).repositories
        const name = Array.isArray(names) ? String(names[0]) : ''
        const repository = [...(github.installations.get(appId) ?? [])].find((r) =>
          r.endsWith(`/${name}`),
        )
        if (repository === undefined) return send(404, { message: 'Not Found' })
        const value = `ghs_${appId}_${github.installationTokens.size + 1}`
        github.installationTokens.set(value, { appId, repository })
        return send(201, {
          token: value,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        })
      }

      const credential = credentialOf(request.headers.authorization)
      github.requests.push({
        method,
        path: `${path}${url.search}`,
        as: credential === undefined ? undefined : nameOf(credential),
        body,
      })
      const override = github.override?.(method, `${path}${url.search}`)
      if (override === 'hang') return
      if (override !== undefined)
        return send(override.status, override.body, override.headers, override.raw)
      if (credential === undefined) return send(401, { message: 'Bad credentials' })

      if (method === 'POST' && path === '/graphql') {
        const { query, variables } = record(body)
        const v = record(variables)
        const item = String(v.itemId)
        if (!github.status.has(item)) {
          return send(200, {
            data: null,
            errors: [
              {
                type: 'NOT_FOUND',
                message: `Could not resolve to a node with the global id of '${item}'`,
              },
            ],
          })
        }
        if (String(query).includes('updateProjectV2ItemFieldValue')) {
          if (credential.kind === 'token' && github.tokens.get(token)?.write !== true) {
            return send(200, {
              data: null,
              errors: [
                { type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' },
              ],
            })
          }
          github.status.set(item, String(v.status))
          return send(200, {
            data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: item } } },
          })
        }
        return send(200, {
          data: { node: { id: item, status: { name: github.status.get(item) } } },
        })
      }

      const repo = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path)
      if (repo === null) return send(404, { message: 'Not Found' })
      const repository =
        `${decodeURIComponent(repo[1] ?? '')}/${decodeURIComponent(repo[2] ?? '')}`.toLowerCase()
      const rest = repo[3] ?? ''
      const { shown, write } = access(credential, token, repository)
      if (!shown) return send(404, { message: 'Not Found' })
      const issues = github.repositories.get(repository) ?? []
      if (rest === '' && method === 'GET') return send(200, { full_name: repository })
      if (rest === '/issues' && method === 'GET') {
        const state = url.searchParams.get('state') ?? 'open'
        const listed = issues.filter((i) => state === 'all' || i.state === state)
        const page = Number(url.searchParams.get('page') ?? '1')
        const slice = listed.slice((page - 1) * github.perPage, page * github.perPage)
        const headers: Record<string, string> = {}
        if (page * github.perPage < listed.length) {
          // As GitHub does, the link names the repository by id, and keeps the query.
          const next = new URL(`http://github.test/repositories/42/issues`)
          for (const [k, val] of url.searchParams) next.searchParams.set(k, val)
          next.searchParams.set('page', String(page + 1))
          headers.link = `<${next.toString()}>; rel="next", <http://github.test/repositories/42/issues?page=9>; rel="last"`
        }
        return send(200, slice, headers)
      }
      if (rest === '/issues' && method === 'POST') {
        if (!write)
          return send(403, {
            message: `Resource not accessible by ${credential.kind === 'app' ? 'integration' : 'personal access token'}`,
          })
        const created: Issue = {
          number: issues.length + 1,
          title: String(record(body).title),
          state: 'open',
          state_reason: null,
          user: { login: nameOf(credential) },
        }
        issues.push(created)
        return send(201, created)
      }
      const one = /^\/issues\/(\d+)$/.exec(rest)
      const found = one === null ? undefined : issues.find((i) => i.number === Number(one[1]))
      if (one !== null && found === undefined) return send(404, { message: 'Not Found' })
      if (found !== undefined && method === 'GET') return send(200, found)
      if (found !== undefined && method === 'PATCH') {
        if (!write)
          return send(403, { message: 'Resource not accessible by personal access token' })
        Object.assign(found, record(body))
        return send(200, found)
      }
      if (rest.includes('/labels/') && method === 'DELETE') return send(204)
      return send(404, { message: 'Not Found' })
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

beforeEach(resetGitHub)

type Given = Partial<Record<GitHubFunction, GitHubAppConfig | string>>

/** The client for functions each given an App (a config) or a token (a string). */
function client(given: Given, options: GitHubClientOptions = {}) {
  const apps: Partial<Record<GitHubFunction, GitHubAppConfig>> = {}
  const tokens: Partial<Record<GitHubFunction, string>> = {}
  for (const fn of githubFunctions) {
    const value = given[fn]
    if (typeof value === 'string') tokens[fn] = value
    else if (value !== undefined) apps[fn] = value
  }
  return createGitHubClient({ apps, tokens }, { apiUrl, ...options })
}

const one = { owner: 'octo', name: 'one' }
const two = { owner: 'octo', name: 'two' }
const privateRepo = { owner: 'octo', name: 'private' }
const tcRepo = { owner: 'tc', name: 'tc-repo' }

const readStatus =
  'query($itemId: ID!) { node(id: $itemId) { ... on ProjectV2Item { status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } } } } }'
const setStatus =
  'mutation($itemId: ID!, $status: String!) { updateProjectV2ItemFieldValue(input: { itemId: $itemId, value: { singleSelectOptionId: $status } }) { projectV2Item { id } } }'

/** Reads and writes an issue, and the Projects status field, on `repository`, each as its function. */
async function useEveryFunction(c: ReturnType<typeof client>, repository = one) {
  const created = await c.rest('writeIssues', repository, {
    method: 'POST',
    path: ['issues'],
    body: { title: 'T' },
  })
  const number = Number(record(created.data).number)
  const read = await c.rest('readIssues', repository, { method: 'GET', path: ['issues', number] })
  await c.graphql('projectsStatus', repository, setStatus, {
    itemId: 'PVTI_1',
    status: 'In progress',
  })
  const status = await c.graphql('projectsStatus', repository, readStatus, { itemId: 'PVTI_1' })
  return { created, read, status }
}

/** Who each request after the App's own was made as, by method and path. */
function madeAs(): string[] {
  return github.requests
    .filter((r) => !r.as?.startsWith('app '))
    .map((r) => `${r.method} ${r.path} as ${r.as}`)
}

// --- Test cases ------------------------------------------------------------------------------------

describe('test cases', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'cold-seance-client-'))
    writeFileSync(join(dir, 'tc-app.pem'), keys.c.pem)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  /** The configuration of TC-260 and TC-261: `tc-app` reads issues and the status field, `tc-bot`'s token writes. */
  function tcConfig() {
    const appSetting = (name: string) => `COLD_SEANCE_GITHUB_APPS_${name}`
    return loadConfig({
      cwd: dir,
      env: {
        COLD_SEANCE_DATABASE_URL: 'postgres://localhost/unused',
        [appSetting('READ_ISSUES_APP_ID')]: '260',
        [appSetting('READ_ISSUES_PRIVATE_KEY_FILE')]: 'tc-app.pem',
        [appSetting('PROJECTS_STATUS_APP_ID')]: '260',
        [appSetting('PROJECTS_STATUS_PRIVATE_KEY_FILE')]: 'tc-app.pem',
        COLD_SEANCE_GITHUB_TOKENS_WRITE_ISSUES: pat.tcBot,
      },
    })
  }

  it('TC-260: an issue is written with the token given for writing, beside an App given for reading', async () => {
    // The tool does not refuse to start on its configuration: it loads, and the client is built.
    const config = tcConfig()
    const c = createGitHubClient(config.github, { apiUrl })
    expect(c.via('readIssues')).toBe('app')
    expect(c.via('writeIssues')).toBe('token')

    // Step 1: T is assigned to tc-repo, so its issue is written to tc-repo (the call the GitHub
    // mirror makes, SC-022; the assignment itself is SC-036's).
    const created = await c.rest('writeIssues', tcRepo, {
      method: 'POST',
      path: ['issues'],
      body: { title: 'T' },
    })

    // Step 2: tc-repo has one issue for T, opened by tc-bot and not by tc-app.
    const issues = github.repositories.get('tc/tc-repo') ?? []
    expect(issues).toHaveLength(1)
    expect(issues[0]?.title).toBe('T')
    expect(issues[0]?.user.login).toBe('tc-bot')
    expect(issues[0]?.user.login).not.toBe('tc-app[bot]')

    // Step 3: tc-writer closes T's issue as completed, on GitHub.
    Object.assign(issues[0] ?? {}, { state: 'closed', state_reason: 'completed' })

    // Step 4: the change made on GitHub is read, with tc-app (what the change handler, SC-023,
    // reads before setting T done).
    const number = Number(record(created.data).number)
    const read = await c.rest('readIssues', tcRepo, { method: 'GET', path: ['issues', number] })
    expect(record(read.data)).toMatchObject({ state: 'closed', state_reason: 'completed' })
    expect(madeAs()).toEqual([
      'POST /repos/tc/tc-repo/issues as tc-bot',
      `GET /repos/tc/tc-repo/issues/${number} as tc-app[bot]`,
    ])
  })

  it('TC-261: a revoked token is reported, naming the function it is given for', async () => {
    const reported: GitHubTokenRefusedError[] = []
    const c = createGitHubClient(tcConfig().github, {
      apiUrl,
      onTokenRefused: (r) => void reported.push(r),
    })

    // Step 1: tc-bot revokes the token on GitHub.
    github.revoked.add(pat.tcBot)

    // Step 2: T is assigned to tc-repo, so its issue is written to tc-repo.
    const error = await rejection(
      c.rest('writeIssues', tcRepo, { method: 'POST', path: ['issues'], body: { title: 'T' } }),
      GitHubTokenRefusedError,
    )

    // The refusal names the function the token is given for, for the system admins' notification
    // (SC-012 sends it).
    expect(reported).toEqual([error])
    expect(error.function).toBe('writeIssues')
    expect(error.message).toBe(
      'GitHub refuses the personal access token for writing to issues as expired or revoked',
    )
    // No issue for T is opened in tc-repo.
    expect(github.repositories.get('tc/tc-repo')).toEqual([])
  })
})

// --- Unit tests ------------------------------------------------------------------------------------

describe('GitHub client (SC-106)', () => {
  describe('reads and writes issues and the Projects status field, as each function is given', () => {
    it('with one App per function, calls as each function’s own App', async () => {
      const c = client({
        readIssues: app.reader,
        writeIssues: app.writer,
        projectsStatus: app.projects,
      })
      const { created, read, status } = await useEveryFunction(c)
      expect(created.status).toBe(201)
      expect(record(created.data).user).toEqual({ login: 'writer[bot]' })
      expect(record(read.data).title).toBe('T')
      expect(status).toEqual({ node: { id: 'PVTI_1', status: { name: 'In progress' } } })
      expect(madeAs()).toEqual([
        'POST /repos/octo/one/issues as writer[bot]',
        'GET /repos/octo/one/issues/1 as reader[bot]',
        'POST /graphql as projects[bot]',
        'POST /graphql as projects[bot]',
      ])
    })

    it('with one App for every function, calls as that App', async () => {
      const c = client({ readIssues: app.all, writeIssues: app.all, projectsStatus: app.all })
      await useEveryFunction(c)
      expect(new Set(madeAs().map((r) => r.split(' as ')[1]))).toEqual(new Set(['all[bot]']))
    })

    it('with one token per function, calls as each token’s account', async () => {
      const c = client({ readIssues: pat.dave, writeIssues: pat.bot, projectsStatus: pat.carol })
      const { created } = await useEveryFunction(c)
      expect(record(created.data).user).toEqual({ login: 'bot' })
      expect(madeAs()).toEqual([
        'POST /repos/octo/one/issues as bot',
        'GET /repos/octo/one/issues/1 as dave',
        'POST /graphql as carol',
        'POST /graphql as carol',
      ])
    })

    it('with one token for every function, calls as its account', async () => {
      const c = client({ readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot })
      await useEveryFunction(c)
      expect(new Set(madeAs().map((r) => r.split(' as ')[1]))).toEqual(new Set(['bot']))
    })

    it('with Apps and tokens mixed across functions, calls each as given', async () => {
      const c = client({ readIssues: pat.dave, writeIssues: app.writer, projectsStatus: pat.bot })
      expect(githubFunctions.map((fn) => c.via(fn))).toEqual(['token', 'app', 'token'])
      await useEveryFunction(c)
      expect(madeAs()).toEqual([
        'POST /repos/octo/one/issues as writer[bot]',
        'GET /repos/octo/one/issues/1 as dave',
        'POST /graphql as bot',
        'POST /graphql as bot',
      ])
    })

    it('uses a function’s App or token on every repository, with the App’s token for each', async () => {
      const c = client({
        readIssues: app.reader,
        writeIssues: pat.bot,
        projectsStatus: app.projects,
      })
      await useEveryFunction(c, one)
      await useEveryFunction(c, two)
      expect(madeAs().filter((r) => r.includes('/issues'))).toEqual([
        'POST /repos/octo/one/issues as bot',
        'GET /repos/octo/one/issues/1 as reader[bot]',
        'POST /repos/octo/two/issues as bot',
        'GET /repos/octo/two/issues/1 as reader[bot]',
      ])
      // The App's installation token for each repository is scoped to it.
      expect(
        [...github.installationTokens.values()].map((t) => `${t.appId} ${t.repository}`).sort(),
      ).toEqual(['11 octo/one', '11 octo/two', '13 octo/one', '13 octo/two'])
    })

    it('sends GitHub’s headers, the token as a bearer, and JSON only with a body', async () => {
      const seen: Headers[] = []
      const fetch: typeof globalThis.fetch = async (input, init) => {
        seen.push(new Headers(init?.headers))
        return globalThis.fetch(input, init)
      }
      const c = client(
        { readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot },
        { fetch },
      )
      await c.rest('readIssues', one, { method: 'GET', path: [] })
      await c.rest('writeIssues', one, { method: 'POST', path: ['issues'], body: { title: 'x' } })
      expect(seen[0]?.get('authorization')).toBe(`Bearer ${pat.bot}`)
      expect(seen[0]?.get('accept')).toBe('application/vnd.github+json')
      expect(seen[0]?.get('x-github-api-version')).toBe('2022-11-28')
      expect(seen[0]?.get('user-agent')).toBe('cold-seance')
      expect(seen[0]?.has('content-type')).toBe(false)
      expect(seen[1]?.get('content-type')).toBe('application/json')
    })

    it('updates an issue, and answers an empty body with no data', async () => {
      const c = client({ readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot })
      await c.rest('writeIssues', one, { method: 'POST', path: ['issues'], body: { title: 'x' } })
      const closed = await c.rest('writeIssues', one, {
        method: 'PATCH',
        path: ['issues', 1],
        body: { state: 'closed', state_reason: 'not_planned' },
      })
      expect(record(closed.data)).toMatchObject({ state: 'closed', state_reason: 'not_planned' })
      const removed = await c.rest('writeIssues', one, {
        method: 'DELETE',
        path: ['issues', 1, 'labels', 'a/b c'],
      })
      expect(removed).toEqual({ status: 204, data: undefined })
      // Each segment is encoded, so a `/` in one stays inside it.
      expect(github.requests.at(-1)?.path).toBe('/repos/octo/one/issues/1/labels/a%2Fb%20c')
    })

    it('reads every page of a list, keeping the request’s path and query', async () => {
      const c = client({ readIssues: app.reader, writeIssues: pat.bot, projectsStatus: pat.bot })
      for (const title of ['a', 'b', 'c', 'd', 'e']) {
        await c.rest('writeIssues', one, { method: 'POST', path: ['issues'], body: { title } })
      }
      const issues = await c.restPages('readIssues', one, {
        path: ['issues'],
        query: { state: 'all', per_page: 2 },
      })
      expect(issues.map((i) => record(i).title)).toEqual(['a', 'b', 'c', 'd', 'e'])
      expect(madeAs().filter((r) => r.startsWith('GET'))).toEqual([
        'GET /repos/octo/one/issues?state=all&per_page=2 as reader[bot]',
        'GET /repos/octo/one/issues?state=all&per_page=2&page=2 as reader[bot]',
        'GET /repos/octo/one/issues?state=all&per_page=2&page=3 as reader[bot]',
      ])
    })

    it('reads a list of one page', async () => {
      const c = client({ readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot })
      expect(await c.restPages('readIssues', one, { path: ['issues'] })).toEqual([])
    })

    it('calls the GraphQL API of GitHub Enterprise Server beside its REST API', async () => {
      const urls: string[] = []
      const fetch: typeof globalThis.fetch = async (input) => {
        urls.push(input instanceof Request ? input.url : input.toString())
        return new Response(JSON.stringify({ data: {} }), { status: 200 })
      }
      const ghe = createGitHubClient(
        {
          apps: {},
          tokens: { readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot },
        },
        { apiUrl: 'https://ghe.example/api/v3/', fetch },
      )
      await ghe.graphql('projectsStatus', one, '{ viewer { login } }')
      await ghe.rest('readIssues', one, { method: 'GET', path: [] })
      const dotcom = createGitHubClient(
        {
          apps: {},
          tokens: { readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot },
        },
        { fetch },
      )
      await dotcom.graphql('projectsStatus', one, '{ viewer { login } }')
      expect(urls).toEqual([
        'https://ghe.example/api/graphql',
        'https://ghe.example/api/v3/repos/octo/one',
        'https://api.github.com/graphql',
      ])
    })
  })

  describe('reports which function’s App or token cannot reach a repository', () => {
    it('names the function whose App is not installed on the repository', async () => {
      const c = client({
        readIssues: app.reader,
        writeIssues: pat.bot,
        projectsStatus: app.projects,
      })
      for (const call of [
        c.rest('readIssues', privateRepo, { method: 'GET', path: ['issues'] }),
        c.graphql('projectsStatus', privateRepo, readStatus, { itemId: 'PVTI_1' }),
      ]) {
        const error = await rejection(call, GitHubUnreachableError)
        expect(['readIssues', 'projectsStatus']).toContain(error.function)
        expect(error.via).toBe('app')
        expect(error.repository).toBe('octo/private')
      }
      const error = await rejection(
        c.rest('readIssues', privateRepo, { method: 'GET', path: ['issues'] }),
        GitHubUnreachableError,
      )
      expect(error.message).toBe(
        'The GitHub App for reading issues cannot reach octo/private: the App (App 11) is not installed on it, or it does not exist',
      )
      // Nothing was asked of the repository itself.
      expect(madeAs()).toEqual([])
    })

    it('names the function whose token is not given the repository', async () => {
      const c = client({
        readIssues: app.reader,
        writeIssues: pat.carol,
        projectsStatus: app.projects,
      })
      await c.rest('writeIssues', one, { method: 'POST', path: ['issues'], body: { title: 'x' } })
      const error = await rejection(
        c.rest('writeIssues', two, { method: 'POST', path: ['issues'], body: { title: 'x' } }),
        GitHubUnreachableError,
      )
      expect(error).toMatchObject({ function: 'writeIssues', via: 'token', repository: 'octo/two' })
      expect(error.message).toBe(
        'The personal access token for writing to issues cannot reach octo/two: GitHub does not show it the repository',
      )
      // The 404 was told apart from a missing issue by asking for the repository itself.
      expect(madeAs().slice(1)).toEqual([
        'POST /repos/octo/two/issues as carol',
        'GET /repos/octo/two as carol',
      ])
      expect(github.repositories.get('octo/two')).toEqual([])
    })

    it('reports the repository itself not shown, with no second request', async () => {
      const c = client({ readIssues: pat.carol, writeIssues: pat.carol, projectsStatus: pat.carol })
      const error = await rejection(
        c.rest('readIssues', two, { method: 'GET', path: [] }),
        GitHubUnreachableError,
      )
      expect(error.function).toBe('readIssues')
      expect(madeAs()).toEqual(['GET /repos/octo/two as carol'])
    })

    it('tells a missing issue on a reachable repository from an unreachable repository', async () => {
      const c = client({ readIssues: pat.carol, writeIssues: pat.carol, projectsStatus: pat.carol })
      const error = await rejection(
        c.rest('readIssues', one, { method: 'GET', path: ['issues', 7] }),
        GitHubRequestError,
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe(
        'GitHub refused or failed a call for reading issues on octo/one: GitHub answered 404 (Not Found)',
      )
    })

    it('names the function whose App or token GitHub refuses the access its function needs', async () => {
      const c = client({ readIssues: pat.dave, writeIssues: pat.dave, projectsStatus: pat.dave })
      const error = await rejection(
        c.rest('writeIssues', one, { method: 'POST', path: ['issues'], body: { title: 'x' } }),
        GitHubUnreachableError,
      )
      expect(error.message).toBe(
        'The personal access token for writing to issues cannot reach octo/one: GitHub answered 403 (Resource not accessible by personal access token)',
      )
      const forbidden = await rejection(
        c.graphql('projectsStatus', one, setStatus, { itemId: 'PVTI_1', status: 'Done' }),
        GitHubUnreachableError,
      )
      expect(forbidden.message).toBe(
        'The personal access token for the Projects status field cannot reach octo/one: FORBIDDEN: Resource not accessible by personal access token',
      )
      expect(github.status.get('PVTI_1')).toBe('Todo')
    })

    it('reports a GraphQL NOT_FOUND as unreachable only when the repository is not shown', async () => {
      const c = client({ readIssues: pat.carol, writeIssues: pat.carol, projectsStatus: pat.carol })
      const missing = await rejection(
        c.graphql('projectsStatus', one, readStatus, { itemId: 'PVTI_9' }),
        GitHubRequestError,
      )
      expect(missing.graphqlErrors).toEqual([
        {
          type: 'NOT_FOUND',
          message: "Could not resolve to a node with the global id of 'PVTI_9'",
        },
      ])
      expect(missing.status).toBe(200)
      const unreachable = await rejection(
        c.graphql('projectsStatus', two, readStatus, { itemId: 'PVTI_9' }),
        GitHubUnreachableError,
      )
      expect(unreachable.repository).toBe('octo/two')
    })

    it('does not count a rate limit as a refusal of access', async () => {
      const c = client({ readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot })
      const limits: Record<string, string>[] = [
        { 'x-ratelimit-remaining': '0' },
        { 'retry-after': '60' },
      ]
      for (const headers of limits) {
        github.override = () => ({
          status: 403,
          body: { message: 'API rate limit exceeded' },
          headers,
        })
        const error = await rejection(
          c.rest('readIssues', one, { method: 'GET', path: ['issues'] }),
          GitHubRequestError,
        )
        expect(error.status).toBe(403)
        expect(error.message).toMatch(/GitHub answered 403 \(API rate limit exceeded\)$/)
      }
      github.override = () => ({ status: 429, raw: 'slow down' })
      const error = await rejection(
        c.rest('readIssues', one, { method: 'GET', path: ['issues'] }),
        GitHubRequestError,
      )
      expect(error.message).toMatch(/GitHub answered 429$/)
    })

    it('keeps the 404 when the repository cannot be asked for', async () => {
      const c = client({ readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot })
      // The repository answers 500, then GitHub cannot be reached at all.
      github.override = (_method, path) =>
        path === '/repos/octo/one'
          ? { status: 500 }
          : { status: 404, body: { message: 'Not Found' } }
      expect(
        (
          await rejection(
            c.rest('readIssues', one, { method: 'GET', path: ['issues', 1] }),
            GitHubRequestError,
          )
        ).status,
      ).toBe(404)
      github.override = (_method, path) => (path === '/repos/octo/one' ? 'hang' : { status: 404 })
      const slow = client(
        { readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot },
        { requestTimeout: 100 },
      )
      const error = await rejection(
        slow.rest('readIssues', one, { method: 'GET', path: ['issues', 1] }),
        GitHubRequestError,
      )
      expect(error.status).toBe(404)
      expect(error.message).toMatch(/GitHub answered 404$/)
    })
  })

  describe('reports which function’s personal access token GitHub refuses as expired or revoked', () => {
    it('names the function, and tells onTokenRefused of each refusal', async () => {
      const reported: string[] = []
      const c = client(
        { readIssues: pat.bot, writeIssues: pat.carol, projectsStatus: pat.carol },
        { onTokenRefused: (r) => void reported.push(`${r.function} ${r.repository}`) },
      )
      github.revoked.add(pat.carol)
      const rest = await rejection(
        c.rest('writeIssues', one, { method: 'POST', path: ['issues'], body: { title: 'x' } }),
        GitHubTokenRefusedError,
      )
      expect(rest).toMatchObject({ function: 'writeIssues', via: 'token', repository: 'octo/one' })
      const graphql = await rejection(
        c.graphql('projectsStatus', one, readStatus, { itemId: 'PVTI_1' }),
        GitHubTokenRefusedError,
      )
      expect(graphql.message).toBe(
        'GitHub refuses the personal access token for the Projects status field as expired or revoked',
      )
      // Each refusal is told; the function given a working token goes on.
      await rejection(
        c.rest('writeIssues', two, { method: 'GET', path: [] }),
        GitHubTokenRefusedError,
      )
      expect(reported).toEqual([
        'writeIssues octo/one',
        'projectsStatus octo/one',
        'writeIssues octo/two',
      ])
      expect((await c.rest('readIssues', one, { method: 'GET', path: [] })).status).toBe(200)
      expect(reported).toHaveLength(3)
    })

    it('waits for onTokenRefused, and keeps what it throws on the refusal', async () => {
      const failure = new Error('notification failed')
      let told = false
      const c = client(
        { readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot },
        {
          onTokenRefused: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            told = true
            throw failure
          },
        },
      )
      github.revoked.add(pat.bot)
      const error = await rejection(
        c.rest('readIssues', one, { method: 'GET', path: [] }),
        GitHubTokenRefusedError,
      )
      expect(told).toBe(true)
      expect(error.reportError).toBe(failure)
    })

    it('refuses without onTokenRefused, and never puts the token in a message', async () => {
      const c = client({ readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot })
      github.revoked.add(pat.bot)
      const error = await rejection(
        c.rest('readIssues', one, { method: 'GET', path: ['issues'] }),
        GitHubTokenRefusedError,
      )
      expect(error.reportError).toBeUndefined()
      expect(error.message).not.toContain(pat.bot)
      expect(error.stack).not.toContain(pat.bot)
    })

    it('does not report an App’s installation token refused as a personal access token', async () => {
      const reported: unknown[] = []
      const c = client(
        { readIssues: app.reader, writeIssues: app.reader, projectsStatus: app.reader },
        { onTokenRefused: (r) => void reported.push(r) },
      )
      github.override = (_method, path) =>
        path === '/repos/octo/one'
          ? { status: 401, body: { message: 'Bad credentials' } }
          : undefined
      const error = await rejection(
        c.rest('readIssues', one, { method: 'GET', path: [] }),
        GitHubRequestError,
      )
      expect(error).toMatchObject({ status: 401, via: 'app' })
      expect(reported).toEqual([])
    })
  })

  describe('reports GitHub’s other refusals and failures', () => {
    const tokens = { readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot }

    it('reports an error answer with GitHub’s status and message', async () => {
      github.override = () => ({ status: 422, body: { message: 'Validation Failed' } })
      const error = await rejection(
        client(tokens).rest('writeIssues', one, { method: 'POST', path: ['issues'], body: {} }),
        GitHubRequestError,
      )
      expect(error).toMatchObject({
        status: 422,
        function: 'writeIssues',
        via: 'token',
        graphqlErrors: [],
      })
      expect(error.message).toBe(
        'GitHub refused or failed a call for writing to issues on octo/one: GitHub answered 422 (Validation Failed)',
      )
    })

    it('refuses a success that is not JSON', async () => {
      github.override = () => ({ status: 200, raw: '<html>' })
      const error = await rejection(
        client(tokens).rest('readIssues', one, { method: 'GET', path: [] }),
        GitHubRequestError,
      )
      expect(error.message).toMatch(/GitHub answered 200 without JSON$/)
      const graphql = await rejection(
        client(tokens).graphql('readIssues', one, '{}'),
        GitHubRequestError,
      )
      expect(graphql.message).toMatch(/GitHub answered without data$/)
    })

    it('refuses a GraphQL answer with errors of other kinds, or without data', async () => {
      github.override = () => ({
        status: 200,
        body: { errors: [{ type: 'RATE_LIMITED', message: 'slow' }, { message: 'other' }, {}] },
      })
      const error = await rejection(
        client(tokens).graphql('projectsStatus', one, '{}'),
        GitHubRequestError,
      )
      expect(error.message).toMatch(/: RATE_LIMITED: slow; other; GitHub gave no message$/)
      expect(error.graphqlErrors).toEqual([
        { type: 'RATE_LIMITED', message: 'slow' },
        { message: 'other' },
        { message: 'GitHub gave no message' },
      ])
      github.override = () => ({ status: 200, body: { data: null } })
      await rejection(client(tokens).graphql('projectsStatus', one, '{}'), GitHubRequestError)
      github.override = () => ({ status: 502, body: { message: 'Bad Gateway' } })
      const gateway = await rejection(
        client(tokens).graphql('projectsStatus', one, '{}'),
        GitHubRequestError,
      )
      expect(gateway.status).toBe(502)
    })

    it('refuses a page that is not a list, and a next page already read', async () => {
      github.override = () => ({ status: 200, body: { items: [] } })
      const notList = await rejection(
        client(tokens).restPages('readIssues', one, { path: ['issues'] }),
        GitHubRequestError,
      )
      expect(notList.message).toMatch(/a page that is not a list$/)
      github.override = () => ({
        status: 200,
        body: [1],
        headers: { link: '<http://github.test/repositories/42/issues?page=2>; rel="next"' },
      })
      const loop = await rejection(
        client(tokens).restPages('readIssues', one, { path: ['issues'] }),
        GitHubRequestError,
      )
      expect(loop.message).toMatch(/next page is one already read$/)
      expect(github.requests.map((r) => r.path)).toEqual([
        '/repos/octo/one/issues',
        '/repos/octo/one/issues',
        '/repos/octo/one/issues?page=2',
      ])
    })

    it('stops at a link with no usable next page', async () => {
      for (const link of [
        '<not a url>; rel="next"',
        '<http://github.test/x?page=2>; rel="last"',
        'garbage',
      ]) {
        github.override = () => ({ status: 200, body: [1], headers: { link } })
        expect(await client(tokens).restPages('readIssues', one, { path: ['issues'] })).toEqual([1])
      }
    })

    it('names the cause of a failed connection, without the token', async () => {
      const port = await closedPort()
      const c = createGitHubClient({ apps: {}, tokens }, { apiUrl: `http://127.0.0.1:${port}` })
      const error = await rejection(
        c.rest('readIssues', one, { method: 'GET', path: [] }),
        GitHubRequestError,
      )
      expect(error.status).toBeUndefined()
      expect(error.message).toMatch(
        /: GitHub cannot be reached: fetch failed: connect ECONNREFUSED /,
      )
      expect(error.message).not.toContain(pat.bot)
    })

    it('gives up a call that takes longer than the timeout', async () => {
      github.override = () => 'hang'
      const c = client(tokens, { requestTimeout: 50 })
      const error = await rejection(c.graphql('projectsStatus', one, '{}'), GitHubRequestError)
      expect(error.message).toMatch(/GitHub cannot be reached: .*time/i)
    })

    it('reports an App whose token cannot be obtained', async () => {
      const unknown = appConfig(99, rsaKey().pem)
      const c = client({ readIssues: unknown, writeIssues: pat.bot, projectsStatus: pat.bot })
      const error = await rejection(
        c.rest('readIssues', one, { method: 'GET', path: [] }),
        GitHubRequestError,
      )
      expect(error).toMatchObject({ function: 'readIssues', via: 'app', status: 401 })
      const port = await closedPort()
      const offline = createGitHubClient(
        {
          apps: { readIssues: app.reader },
          tokens: { writeIssues: pat.bot, projectsStatus: pat.bot },
        },
        { apiUrl: `http://127.0.0.1:${port}`, now: Date.now },
      )
      const unreachable = await rejection(
        offline.rest('readIssues', one, { method: 'GET', path: [] }),
        GitHubRequestError,
      )
      expect(unreachable.status).toBeUndefined()
      expect(unreachable.message).toMatch(/cannot be obtained: GitHub cannot be reached/)
    })
  })

  describe('refuses what is not a call on a repository', () => {
    const c = () => client({ readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot })

    it('refuses a repository name GitHub does not allow, before calling GitHub', async () => {
      for (const repository of [
        { owner: 'octo', name: '..' },
        { owner: '../x', name: 'one' },
      ]) {
        await rejection(c().rest('readIssues', repository, { method: 'GET', path: [] }), TypeError)
        await rejection(c().graphql('readIssues', repository, '{}'), TypeError)
      }
      expect(github.requests).toEqual([])
    })

    it('refuses a path segment that would leave the repository', async () => {
      for (const s of ['', '.', '..']) {
        await rejection(
          c().rest('readIssues', one, { method: 'GET', path: ['issues', s] }),
          TypeError,
        )
      }
      expect(github.requests).toEqual([])
    })
  })

  describe('is built from the functions given in the configuration', () => {
    it('refuses a function given both an App and a token, or neither', () => {
      expect(() =>
        createGitHubClient({
          apps: { readIssues: app.reader },
          tokens: { readIssues: pat.bot, writeIssues: pat.bot, projectsStatus: pat.bot },
        }),
      ).toThrow(
        'The GitHub function for reading issues must be given an App or a personal access token, not both',
      )
      expect(() =>
        createGitHubClient({ apps: {}, tokens: { readIssues: pat.bot, writeIssues: pat.bot } }),
      ).toThrow(
        'The GitHub function for the Projects status field must be given an App or a personal access token, not neither',
      )
    })

    it('refuses an App key that is not an RSA private key, naming its setting', () => {
      const bad = { ...app.reader, privateKey: 'not a key' }
      expect(() =>
        client({ readIssues: bad, writeIssues: pat.bot, projectsStatus: pat.bot }),
      ).toThrow(ConfigError)
    })
  })
})
