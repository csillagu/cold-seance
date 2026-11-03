import { createPrivateKey, sign, type KeyObject } from 'node:crypto'
import {
  ConfigError,
  envName,
  githubFunctionLabels,
  githubFunctions,
  type GitHubAppConfig,
  type GitHubFunction,
} from '../config/config.ts'

/**
 * The GitHub App tokens (SC-108, DD-058): holds the GitHub Apps given in the configuration (DD-059)
 * for the functions given an App rather than a personal access token (DD-060), one per function or
 * one for several or all of them; signs the App's own requests with its private key; obtains the
 * token of the App's installation on each repository; and keeps each token until shortly before it
 * expires. A function whose App is not installed on a repository is reported by name.
 */

/** A repository on GitHub, as `owner/name`. */
export interface Repository {
  owner: string
  name: string
}

export const defaultGitHubApiUrl = 'https://api.github.com'

/** An installation token is renewed this long before it expires, so a call never carries a stale one. */
export const tokenRenewalMargin = 5 * 60_000

/**
 * The App's own token (a JWT) is backdated by a minute against clock drift, as GitHub advises, and
 * lives ten minutes from then, the longest GitHub accepts. It is renewed a minute before it expires.
 */
const jwtBackdate = 60_000
const jwtLifetime = 10 * 60_000
const jwtRenewalMargin = 60_000

export const defaultRequestTimeout = 30_000

export interface GitHubAppTokensOptions {
  /** GitHub's REST API; `https://api.github.com` unless given. */
  apiUrl?: string
  /** Defaults to the global `fetch`. */
  fetch?: typeof fetch
  /** The current time in milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** How long a request to GitHub may take before it is given up, in milliseconds. */
  requestTimeout?: number
}

export function repositoryName(repository: Repository): string {
  return `${repository.owner}/${repository.name}`
}

/** The App given for `fn` is not installed on the repository, or GitHub does not show it the repository. */
export class GitHubAppNotInstalledError extends Error {
  readonly function: GitHubFunction
  readonly appId: number
  readonly repository: string

  constructor(fn: GitHubFunction, appId: number, repository: Repository) {
    const name = repositoryName(repository)
    super(
      `The GitHub App for ${githubFunctionLabels[fn]} (App ${appId}) is not installed on ${name}, or the repository does not exist`,
    )
    this.name = 'GitHubAppNotInstalledError'
    this.function = fn
    this.appId = appId
    this.repository = name
  }
}

/** GitHub refused, or could not be reached for, the token of `fn`'s App on the repository. */
export class GitHubAppTokenError extends Error {
  readonly function: GitHubFunction
  readonly appId: number
  readonly repository: string
  /** GitHub's HTTP status, if it answered. */
  readonly status: number | undefined

  constructor(
    fn: GitHubFunction,
    appId: number,
    repository: Repository,
    reason: string,
    status?: number,
  ) {
    const name = repositoryName(repository)
    super(
      `The token of the GitHub App for ${githubFunctionLabels[fn]} (App ${appId}) on ${name} cannot be obtained: ${reason}`,
    )
    this.name = 'GitHubAppTokenError'
    this.function = fn
    this.appId = appId
    this.repository = name
    this.status = status
  }
}

export interface GitHubAppTokens {
  /**
   * A valid token of the installation, on `repository`, of the App given for `fn`. It is the one
   * kept from an earlier call unless that one expires within `tokenRenewalMargin`. Throws a
   * `GitHubAppNotInstalledError` if the App is not installed on the repository, and a
   * `GitHubAppTokenError` if GitHub refuses the token or cannot be reached. A function given no
   * App, since it is given a personal access token, is refused with a `TypeError`: its token is
   * the configured one, not this module's.
   */
  token(fn: GitHubFunction, repository: Repository): Promise<string>
  /**
   * Drops the token kept for `fn`'s App on `repository`, so that the next `token` asks GitHub
   * again: for a token GitHub no longer accepts, such as one of an installation since deleted.
   */
  forget(fn: GitHubFunction, repository: Repository): void
}

interface CachedToken {
  token: string
  /** When the token is renewed: shortly before it expires. */
  renewAt: number
}

/** What GitHub answered, before it is put in terms of the function that asked. */
type Outcome = { token: string } | { notInstalled: true } | { reason: string; status?: number }

/** The token is the App's installation token, scoped to the one repository it was obtained for. */
interface App {
  id: number
  key: KeyObject
  jwt: CachedToken | undefined
  tokens: Map<string, CachedToken>
  pending: Map<string, Promise<Outcome>>
}

// The characters and lengths GitHub allows in owner and repository names (a little looser than
// GitHub on hyphens). Checking them keeps a name from reaching outside the repository's path in
// GitHub's API.
const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/
const namePattern = /^[A-Za-z0-9._-]{1,100}$/

/** Refuses, with a `TypeError`, a name GitHub does not allow, so it cannot reach outside its path. */
export function checkRepository(repository: Repository): void {
  const { owner, name } = repository
  if (!ownerPattern.test(owner) || !namePattern.test(name) || name === '.' || name === '..') {
    throw new TypeError(`${owner}/${name} is not a GitHub repository name`)
  }
}

/**
 * Reads the private key of each App given for a function; `apps` holds the functions given an App,
 * as the configuration does, and leaves out those given a token. A key that is not an RSA private
 * key, which GitHub Apps sign with, is reported as a `ConfigError` naming the setting, as the
 * configuration loader reports a key file it cannot read (DD-059). Functions given the same App
 * share it, and so share its tokens.
 */
export function createGitHubAppTokens(
  apps: Partial<Record<GitHubFunction, GitHubAppConfig>>,
  options: GitHubAppTokensOptions = {},
): GitHubAppTokens {
  const apiUrl = (options.apiUrl ?? defaultGitHubApiUrl).replace(/\/+$/, '')
  const doFetch = options.fetch ?? globalThis.fetch
  const now = options.now ?? Date.now
  const requestTimeout = options.requestTimeout ?? defaultRequestTimeout

  const problems: string[] = []
  const byKey = new Map<string, App>()
  const appOf = new Map<GitHubFunction, App>()
  for (const fn of githubFunctions) {
    const config = apps[fn]
    if (config === undefined) continue
    const shared = `${config.appId}\0${config.privateKey}`
    let app = byKey.get(shared)
    if (app === undefined) {
      const key = readPrivateKey(config.privateKey)
      if (key === undefined) {
        const path = ['github', 'apps', fn, 'privateKeyFile']
        problems.push(
          `${path.join('.')} (${envName(path)}): the key file ${config.privateKeyFile} does not hold an RSA private key`,
        )
        continue
      }
      app = { id: config.appId, key, jwt: undefined, tokens: new Map(), pending: new Map() }
      byKey.set(shared, app)
    }
    appOf.set(fn, app)
  }
  if (problems.length > 0) throw new ConfigError(problems)

  function appJwt(app: App): string {
    const at = now()
    if (app.jwt !== undefined && at < app.jwt.renewAt) return app.jwt.token
    const iat = Math.floor((at - jwtBackdate) / 1000)
    const exp = iat + jwtLifetime / 1000
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const payload = base64url(JSON.stringify({ iat, exp, iss: String(app.id) }))
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), app.key)
    const token = `${header}.${payload}.${signature.toString('base64url')}`
    app.jwt = { token, renewAt: exp * 1000 - jwtRenewalMargin }
    return token
  }

  async function call(
    app: App,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const response = await doFetch(`${apiUrl}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${appJwt(app)}`,
        'user-agent': 'cold-seance',
        'x-github-api-version': '2022-11-28',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(requestTimeout),
    })
    // A body cut short (a timeout while it is read) fails here, and is reported as unreachable;
    // only a body that arrived whole but is not JSON counts as no answer.
    const text = await response.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return { status: response.status, json }
  }

  function refused(status: number, json: unknown): Outcome {
    // GitHub's message says why (a key it does not know, a suspended installation); it holds no
    // secret, unlike the request.
    const message = field(json, 'message')
    return {
      reason: `GitHub answered ${status}${typeof message === 'string' ? ` (${message})` : ''}`,
      status,
    }
  }

  async function obtain(app: App, repository: Repository): Promise<Outcome> {
    const owner = encodeURIComponent(repository.owner)
    const name = encodeURIComponent(repository.name)
    try {
      const installation = await call(app, 'GET', `/repos/${owner}/${name}/installation`)
      if (installation.status === 404) return { notInstalled: true }
      if (installation.status !== 200) return refused(installation.status, installation.json)
      const id = field(installation.json, 'id')
      if (typeof id !== 'number' || !Number.isSafeInteger(id)) {
        return { reason: 'GitHub named no installation' }
      }

      // The token is scoped to the one repository, so it cannot act on the installation's others.
      const issued = await call(app, 'POST', `/app/installations/${id}/access_tokens`, {
        repositories: [repository.name],
      })
      // Uninstalled since the lookup above.
      if (issued.status === 404) return { notInstalled: true }
      if (issued.status !== 201) return refused(issued.status, issued.json)
      const token = field(issued.json, 'token')
      const expiresAt = field(issued.json, 'expires_at')
      const expires = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN
      if (typeof token !== 'string' || token === '' || Number.isNaN(expires)) {
        return { reason: 'GitHub answered without a token' }
      }
      app.tokens.set(cacheKey(repository), { token, renewAt: expires - tokenRenewalMargin })
      return { token }
    } catch (error) {
      return { reason: `GitHub cannot be reached: ${failureReason(error)}` }
    }
  }

  return {
    forget(fn, repository) {
      appOf.get(fn)?.tokens.delete(cacheKey(repository))
    },

    async token(fn, repository) {
      // A key that could not be read stopped the construction, so a function given an App has it.
      const app = appOf.get(fn)
      if (app === undefined) {
        throw new TypeError(
          `The GitHub function for ${githubFunctionLabels[fn]} is not given a GitHub App`,
        )
      }
      checkRepository(repository)
      const key = cacheKey(repository)
      const kept = app.tokens.get(key)
      if (kept !== undefined && now() < kept.renewAt) return kept.token
      // Calls that arrive while a token is being obtained, for any function the App serves, wait
      // for the same one.
      let pending = app.pending.get(key)
      if (pending === undefined) {
        pending = obtain(app, repository).finally(() => app.pending.delete(key))
        app.pending.set(key, pending)
      }
      const outcome = await pending
      if ('token' in outcome) return outcome.token
      if ('notInstalled' in outcome) throw new GitHubAppNotInstalledError(fn, app.id, repository)
      throw new GitHubAppTokenError(fn, app.id, repository, outcome.reason, outcome.status)
    },
  }
}

/** GitHub treats owner and repository names without regard to case. */
function cacheKey(repository: Repository): string {
  return repositoryName(repository).toLowerCase()
}

function readPrivateKey(pem: string): KeyObject | undefined {
  try {
    const key = createPrivateKey(pem)
    return key.asymmetricKeyType === 'rsa' ? key : undefined
  } catch {
    return undefined
  }
}

/** The error's message, with its cause's (`fetch failed` alone does not say why). */
export function failureReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const { cause } = error
  return cause instanceof Error ? `${error.message}: ${cause.message}` : error.message
}

function base64url(text: string): string {
  return Buffer.from(text).toString('base64url')
}

function field(json: unknown, name: string): unknown {
  if (typeof json !== 'object' || json === null) return undefined
  const value: unknown = Reflect.get(json, name)
  return value
}
