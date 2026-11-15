import { generateKeyPairSync } from 'node:crypto'
import type { GitHubAppConfig } from '../../src/config/config.ts'
import { createGitHubClient, type GitHubClient } from '../../src/github/client.ts'
import { gitHubRepositoryReach, type RepositoryReach } from '../../src/github/repository-reach.ts'
import { fakeIssues, type FakeIssues } from './github-issues.ts'

const API_URL = 'https://github.test'

/** The personal access token the tool is given in token mode. */
const PAT = 'github_pat_tc_0123456789'

/** A repository on the fake GitHub. */
interface FakeRepository {
  id: number
  owner: string
  name: string
}

/**
 * A fake of the parts of GitHub's REST API the tool asks to tell whether its GitHub App reaches a
 * repository: the App's installation on a repository, an installation token for it, and the
 * repository itself. Repositories are created on it with or without the App installed, as the test
 * cases' "GitHub test repository with the tool's GitHub App installed" need. It does not check the
 * App's signature: the GitHub client's own tests (SC-106) do.
 */
export interface FakeGitHub {
  /** Creates `owner/name` on GitHub, with the tool's App installed on it unless told otherwise. */
  createRepository(fullName: string, options?: { installed?: boolean }): FakeRepository
  uninstall(fullName: string): void
  /** Installs the tool's App on a repository it was uninstalled from. */
  install(fullName: string): void
  /** Renames a repository on GitHub; it keeps its id, and its old name then names nothing. */
  rename(fullName: string, newFullName: string): void
  /** What the tool asks GitHub through the App, as the GitHub client would call it. */
  reach: RepositoryReach
  /** The GitHub client the tool would build, calling this fake. */
  client: () => GitHubClient
  /** The repositories' issues, which the tool reaches as it reaches the repositories. */
  issues: FakeIssues
  /** Requests made to it, as `METHOD /path`. */
  requests: string[]
  /**
   * Cuts the tool's access to GitHub off after `requests` more requests, or at once: every request
   * from then on fails as a network failure would, until `restore` is called.
   */
  cutOffAfter(requests?: number): void
  restore(): void
}

let nextId = 7_000_000

/**
 * `app` (the default) gives the tool a GitHub App for every function; `token`, a personal access
 * token for every function (DD-060), which reaches the repositories the App would be installed on.
 */
export function fakeGitHub(options: { via?: 'app' | 'token' } = {}): FakeGitHub {
  const via = options.via ?? 'app'
  const repositories = new Map<string, FakeRepository>()
  const installed = new Set<string>()
  /** Installation id → repository key; token → repository key. */
  const installations = new Map<number, string>()
  const tokens = new Map<string, string>()
  const requests: string[] = []
  const issues = fakeIssues((key) => repositories.get(key), API_URL)

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })

  let allowed = Number.POSITIVE_INFINITY

  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (allowed <= 0) throw new TypeError('fetch failed')
    allowed -= 1
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input : input.url,
    )
    const method = init?.method ?? 'GET'
    const path = decodeURIComponent(url.pathname)
    requests.push(`${method} ${path}`)
    const auth = new Headers(init?.headers).get('authorization') ?? ''

    const installation = /^\/repos\/([^/]+)\/([^/]+)\/installation$/.exec(path)
    if (method === 'GET' && installation) {
      const key = `${installation[1]}/${installation[2]}`.toLowerCase()
      const repo = repositories.get(key)
      if (!repo || !installed.has(key)) return json(404, { message: 'Not Found' })
      installations.set(repo.id, key)
      return json(200, { id: repo.id })
    }
    const access = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(path)
    if (method === 'POST' && access) {
      const key = installations.get(Number(access[1]))
      if (key === undefined || !installed.has(key)) return json(404, { message: 'Not Found' })
      const token = `ghs_${key.replace(/\W/g, '_')}_${tokens.size}`
      tokens.set(token, key)
      return json(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() })
    }
    if (method === 'POST' && path === '/graphql') {
      const bearer = auth.replace(/^Bearer /, '')
      if (bearer !== PAT && !tokens.has(bearer)) return json(401, { message: 'Bad credentials' })
      const text = typeof init?.body === 'string' ? init.body : '{}'
      const parsed: unknown = JSON.parse(text)
      const query: unknown = Reflect.get(Object(parsed), 'query')
      const given: unknown = Reflect.get(Object(parsed), 'variables')
      const variables: Record<string, unknown> =
        typeof given === 'object' && given !== null ? { ...given } : {}
      const answer = issues.graphql(typeof query === 'string' ? query : '', variables)
      if (answer !== undefined) return json(200, answer)
      return json(200, { errors: [{ message: 'Unknown query' }] })
    }
    const below = /^\/repos\/([^/]+)\/([^/]+)(\/.+)$/.exec(path)
    if (below) {
      const key = `${below[1]}/${below[2]}`.toLowerCase()
      const bearer = auth.replace(/^Bearer /, '')
      const granted = bearer === PAT ? key : tokens.get(bearer)
      if (!repositories.has(key) || granted !== key || !installed.has(key)) {
        return json(404, { message: 'Not Found' })
      }
      const text = typeof init?.body === 'string' ? init.body : undefined
      const answer = issues.handle(
        method,
        key,
        below[3] ?? '',
        text === undefined ? undefined : JSON.parse(text),
      )
      if (answer !== undefined) return answer
    }
    const repository = /^\/repos\/([^/]+)\/([^/]+)$/.exec(path)
    if (method === 'GET' && repository) {
      const key = `${repository[1]}/${repository[2]}`.toLowerCase()
      const bearer = auth.replace(/^Bearer /, '')
      const granted = bearer === PAT ? key : tokens.get(bearer)
      const repo = repositories.get(key)
      if (!repo || granted !== key || !installed.has(key)) {
        return json(404, { message: 'Not Found' })
      }
      return json(200, {
        id: repo.id,
        name: repo.name,
        full_name: `${repo.owner}/${repo.name}`,
        owner: { login: repo.owner },
      })
    }
    return json(404, { message: 'Not Found' })
  }

  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const app: GitHubAppConfig = {
    appId: 260,
    privateKeyFile: '/run/secrets/tc-app.pem',
    privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }),
    webhookSecret: undefined,
  }
  const github =
    via === 'app'
      ? { apps: { readIssues: app, writeIssues: app, projectsStatus: app }, tokens: {} }
      : { apps: {}, tokens: { readIssues: PAT, writeIssues: PAT, projectsStatus: PAT } }
  let client: GitHubClient | undefined
  const clientOf = () => (client ??= createGitHubClient(github, { apiUrl: API_URL, fetch }))
  const reach = gitHubRepositoryReach(clientOf)

  return {
    createRepository(fullName, created = {}) {
      const [owner = '', name = ''] = fullName.split('/')
      const repo = { id: nextId++, owner, name }
      const key = fullName.toLowerCase()
      repositories.set(key, repo)
      if (created.installed !== false) installed.add(key)
      return repo
    },
    uninstall(fullName) {
      installed.delete(fullName.toLowerCase())
    },
    install(fullName) {
      installed.add(fullName.toLowerCase())
    },
    rename(fullName, newFullName) {
      const key = fullName.toLowerCase()
      const repo = repositories.get(key)
      if (!repo) throw new Error(`no repository ${fullName} on the fake GitHub`)
      const [owner = '', name = ''] = newFullName.split('/')
      const newKey = newFullName.toLowerCase()
      repositories.delete(key)
      repositories.set(newKey, { ...repo, owner, name })
      if (installed.delete(key)) installed.add(newKey)
    },
    reach,
    client: clientOf,
    issues,
    requests,
    cutOffAfter(count = 0) {
      allowed = count
    },
    restore() {
      allowed = Number.POSITIVE_INFINITY
    },
  }
}
