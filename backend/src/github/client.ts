import {
  githubFunctionLabels,
  githubFunctions,
  type Config,
  type GitHubFunction,
} from '../config/config.ts'
import {
  checkRepository,
  createGitHubAppTokens,
  defaultGitHubApiUrl,
  defaultRequestTimeout,
  failureReason,
  GitHubAppNotInstalledError,
  GitHubAppTokenError,
  repositoryName,
  type GitHubAppTokensOptions,
  type Repository,
} from './app-tokens.ts'

/**
 * The GitHub client (SC-106, FR-185): the one module through which the tool calls GitHub's REST
 * and GraphQL APIs. Each call names its function (reading issues, writing to issues, the Projects
 * status field) and its repository, and carries the credential given for that function (DD-060):
 * for a function given an App, the token of that App's installation on the repository, from the
 * GitHub App tokens (SC-108, DD-058); for a function given a personal access token, that token.
 * Apps and tokens can be mixed across functions, and a function uses its App or its token on every
 * repository.
 *
 * Besides GitHub's other refusals, it reports which function's App or token cannot reach a
 * repository (`GitHubUnreachableError`) and which function's personal access token GitHub refuses
 * as expired or revoked (`GitHubTokenRefusedError`, also handed to `onTokenRefused`, for the
 * notification of the system admins, FR-186).
 */

/** How a function is given to the tool (DD-060). */
export type GitHubVia = 'app' | 'token'

const viaLabels: Record<GitHubVia, string> = {
  app: 'GitHub App',
  token: 'personal access token',
}

/** Something GitHub refused, or could not be reached for, on a call of `function` on `repository`. */
export abstract class GitHubCallError extends Error {
  readonly function: GitHubFunction
  readonly via: GitHubVia
  /** `owner/name`. */
  readonly repository: string

  constructor(
    fn: GitHubFunction,
    via: GitHubVia,
    repository: Repository,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.function = fn
    this.via = via
    this.repository = repositoryName(repository)
  }
}

/**
 * The App or the token given for `function` cannot reach the repository: GitHub does not show it
 * the repository (the App is not installed on it, the token is not given it), or refuses it the
 * access its function needs there.
 */
export class GitHubUnreachableError extends GitHubCallError {
  constructor(
    fn: GitHubFunction,
    via: GitHubVia,
    repository: Repository,
    reason: string,
    options?: ErrorOptions,
  ) {
    super(
      fn,
      via,
      repository,
      `The ${viaLabels[via]} for ${githubFunctionLabels[fn]} cannot reach ${repositoryName(repository)}: ${reason}`,
      options,
    )
    this.name = 'GitHubUnreachableError'
  }
}

/** GitHub refuses the personal access token given for `function` as expired or revoked (FR-186). */
export class GitHubTokenRefusedError extends GitHubCallError {
  /**
   * What `onTokenRefused` threw, if it did; the refusal is still what the call rejects with. The
   * client logs nothing, so whoever handles the refusal logs this.
   */
  reportError: unknown

  constructor(fn: GitHubFunction, repository: Repository) {
    super(
      fn,
      'token',
      repository,
      `GitHub refuses the personal access token for ${githubFunctionLabels[fn]} as expired or revoked`,
    )
    this.name = 'GitHubTokenRefusedError'
  }
}

/** One error GitHub's GraphQL API answered with. */
export interface GitHubGraphQLError {
  type?: string
  message: string
}

/** Any other refusal or failure: GitHub answered an error, or could not be reached. */
export class GitHubRequestError extends GitHubCallError {
  /** GitHub's HTTP status, if it answered. */
  readonly status: number | undefined
  /** The errors of a GraphQL answer, if it had any. */
  readonly graphqlErrors: readonly GitHubGraphQLError[]

  constructor(
    fn: GitHubFunction,
    via: GitHubVia,
    repository: Repository,
    reason: string,
    details: {
      status?: number
      graphqlErrors?: readonly GitHubGraphQLError[]
      cause?: unknown
    } = {},
  ) {
    super(
      fn,
      via,
      repository,
      `GitHub refused or failed a call for ${githubFunctionLabels[fn]} on ${repositoryName(repository)}: ${reason}`,
      details.cause === undefined ? undefined : { cause: details.cause },
    )
    this.name = 'GitHubRequestError'
    this.status = details.status
    this.graphqlErrors = details.graphqlErrors ?? []
  }
}

export type GitHubMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

/** A REST call on one repository. */
export interface GitHubRestRequest {
  method: GitHubMethod
  /**
   * The path below the repository's (`/repos/{owner}/{name}`), as segments, each of which is
   * encoded: `['issues', 42, 'comments']`. An empty path is the repository itself.
   */
  path: readonly (string | number)[]
  query?: Readonly<Record<string, string | number | boolean>>
  body?: unknown
}

export interface GitHubResponse {
  status: number
  /** The JSON GitHub answered with; `undefined` for an empty answer. */
  data: unknown
}

export interface GitHubClient {
  /** How `fn` is given: an App or a personal access token. */
  via(fn: GitHubFunction): GitHubVia
  /**
   * Calls GitHub's REST API on `repository` as `fn` is given, and resolves with any 2xx answer.
   * Rejects with a `GitHubUnreachableError`, a `GitHubTokenRefusedError` or a `GitHubRequestError`;
   * a 404 on something within a repository the function reaches is a `GitHubRequestError` with
   * status 404. A repository name GitHub does not allow is refused with a `TypeError`.
   */
  rest(
    fn: GitHubFunction,
    repository: Repository,
    request: GitHubRestRequest,
  ): Promise<GitHubResponse>
  /**
   * A REST GET whose answer is a list spread over pages: follows GitHub's `next` links on the same
   * path and resolves with every page's items, in order.
   */
  restPages(
    fn: GitHubFunction,
    repository: Repository,
    request: Omit<GitHubRestRequest, 'method' | 'body'>,
  ): Promise<unknown[]>
  /**
   * Calls GitHub's GraphQL API as `fn` is given on `repository` (the credential is the one for
   * that repository; the query names what it reads or changes), and resolves with the answer's
   * `data`. An answer with errors rejects as `rest` does, as a whole, even if it holds some data.
   */
  graphql(
    fn: GitHubFunction,
    repository: Repository,
    query: string,
    variables?: Readonly<Record<string, unknown>>,
  ): Promise<unknown>
}

export interface GitHubClientOptions extends GitHubAppTokensOptions {
  /**
   * Told of each refusal of a personal access token as expired or revoked, before the call
   * rejects with it, so that the system admins can be notified (FR-186). Once GitHub has refused a
   * function's token, the function stops working until the tool is restarted with a new one
   * (DD-060): its later calls are refused without asking GitHub, and each of them is told here
   * too. It is awaited; what it throws is kept on the refusal as `reportError`.
   */
  onTokenRefused?: (refusal: GitHubTokenRefusedError) => void | Promise<void>
}

/** What GitHub answered, read whole. */
interface Answer {
  status: number
  headers: Headers
  /** `undefined` for an empty body; `invalid` for one that is not JSON. */
  json: unknown
  invalid: boolean
}

/**
 * Builds the client for the functions given in the configuration: each in exactly one of `apps`
 * and `tokens`, as the configuration loader guarantees (DD-060); a function in both, or in
 * neither, is refused with a `TypeError`. An App's key that is not an RSA private key is a
 * `ConfigError`, from the GitHub App tokens (SC-108).
 */
export function createGitHubClient(
  github: Pick<Config['github'], 'apps' | 'tokens'>,
  options: GitHubClientOptions = {},
): GitHubClient {
  for (const fn of githubFunctions) {
    const app = github.apps[fn] !== undefined
    const token = github.tokens[fn] !== undefined
    if (app === token) {
      throw new TypeError(
        `The GitHub function for ${githubFunctionLabels[fn]} must be given an App or a personal access token, not ${app ? 'both' : 'neither'}`,
      )
    }
  }

  const apiUrl = (options.apiUrl ?? defaultGitHubApiUrl).replace(/\/+$/, '')
  const doFetch = options.fetch ?? globalThis.fetch
  const requestTimeout = options.requestTimeout ?? defaultRequestTimeout
  const appTokens = createGitHubAppTokens(github.apps, {
    apiUrl,
    fetch: doFetch,
    requestTimeout,
    ...(options.now === undefined ? {} : { now: options.now }),
  })

  const via = (fn: GitHubFunction): GitHubVia => (github.tokens[fn] === undefined ? 'app' : 'token')
  /** The functions whose token GitHub has refused as expired or revoked since the start. */
  const refusedTokens = new Set<GitHubFunction>()

  async function credential(fn: GitHubFunction, repository: Repository): Promise<string> {
    const token = github.tokens[fn]
    if (token !== undefined) {
      if (refusedTokens.has(fn)) throw await tokenRefused(fn, repository)
      return token
    }
    try {
      return await appTokens.token(fn, repository)
    } catch (error) {
      if (error instanceof GitHubAppNotInstalledError) {
        throw new GitHubUnreachableError(
          fn,
          'app',
          repository,
          `the App (App ${error.appId}) is not installed on it, or it does not exist`,
          { cause: error },
        )
      }
      // A suspended installation, or an App refused the repository: not a rate limit.
      if (error instanceof GitHubAppTokenError && error.status === 403) {
        throw new GitHubUnreachableError(fn, 'app', repository, error.message, { cause: error })
      }
      if (error instanceof GitHubAppTokenError) {
        throw new GitHubRequestError(fn, 'app', repository, error.message, {
          ...(error.status === undefined ? {} : { status: error.status }),
          cause: error,
        })
      }
      // Not reached: the repository name was checked before, which is all else the App tokens refuse.
      throw error
    }
  }

  async function send(
    fn: GitHubFunction,
    repository: Repository,
    token: string,
    method: GitHubMethod,
    url: string,
    body: unknown,
  ): Promise<Answer> {
    try {
      const response = await doFetch(url, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${token}`,
          'user-agent': 'cold-seance',
          'x-github-api-version': '2022-11-28',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(requestTimeout),
      })
      const text = await response.text()
      let json: unknown
      let invalid = false
      if (text !== '') {
        try {
          json = JSON.parse(text)
        } catch {
          invalid = true
        }
      }
      return { status: response.status, headers: response.headers, json, invalid }
    } catch (error) {
      // The message of a failed fetch holds the URL at most, never the token.
      throw new GitHubRequestError(
        fn,
        via(fn),
        repository,
        `GitHub cannot be reached: ${failureReason(error)}`,
        {
          cause: error,
        },
      )
    }
  }

  function repositoryUrl(repository: Repository): string {
    return `${apiUrl}/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
  }

  /**
   * After a 404 within the repository, whether the function's credential is shown the repository
   * at all: the unreachable error if it is not, nothing if it is or if that cannot be told.
   */
  async function unreachable(
    fn: GitHubFunction,
    repository: Repository,
    token: string,
  ): Promise<GitHubCallError | undefined> {
    let shown: Answer
    try {
      shown = await send(fn, repository, token, 'GET', repositoryUrl(repository), undefined)
    } catch {
      return undefined
    }
    const refused = await refusal(fn, repository, token, shown, true)
    return refused instanceof GitHubRequestError ? undefined : refused
  }

  /**
   * Puts a refusal in terms of the function, or returns nothing for an answer that is not one.
   * `isRepository` says whether the call was on the repository itself, so a 404 needs no probe.
   */
  async function refusal(
    fn: GitHubFunction,
    repository: Repository,
    token: string,
    answer: Answer,
    isRepository: boolean,
  ): Promise<GitHubCallError | undefined> {
    const { status } = answer
    if (status === 401 && via(fn) === 'token') {
      refusedTokens.add(fn)
      return tokenRefused(fn, repository)
    }
    if (status === 403 && !rateLimited(answer)) {
      return new GitHubUnreachableError(
        fn,
        via(fn),
        repository,
        `GitHub answered 403${gitHubMessage(answer)}`,
      )
    }
    if (status === 404) {
      if (isRepository) {
        return new GitHubUnreachableError(
          fn,
          via(fn),
          repository,
          'GitHub does not show it the repository',
        )
      }
      const notShown = await unreachable(fn, repository, token)
      if (notShown !== undefined) return notShown
    }
    if (status >= 200 && status < 300) return undefined
    return new GitHubRequestError(
      fn,
      via(fn),
      repository,
      `GitHub answered ${status}${gitHubMessage(answer)}`,
      {
        status,
      },
    )
  }

  async function tokenRefused(
    fn: GitHubFunction,
    repository: Repository,
  ): Promise<GitHubTokenRefusedError> {
    const error = new GitHubTokenRefusedError(fn, repository)
    if (options.onTokenRefused !== undefined) {
      try {
        await options.onTokenRefused(error)
      } catch (reportError) {
        error.reportError = reportError
      }
    }
    return error
  }

  /**
   * Sends the call with the function's credential. An installation token GitHub no longer accepts
   * (its installation deleted since the token was kept) is dropped, and the call sent once more
   * with a new one, so that an App no longer installed is reported as such.
   */
  async function exchange(
    fn: GitHubFunction,
    repository: Repository,
    method: GitHubMethod,
    url: string,
    body: unknown,
  ): Promise<{ token: string; answer: Answer }> {
    let token = await credential(fn, repository)
    let answer = await send(fn, repository, token, method, url, body)
    if (answer.status === 401 && via(fn) === 'app') {
      appTokens.forget(fn, repository)
      token = await credential(fn, repository)
      answer = await send(fn, repository, token, method, url, body)
    }
    return { token, answer }
  }

  async function call(
    fn: GitHubFunction,
    repository: Repository,
    request: GitHubRestRequest,
  ): Promise<GitHubResponse & { headers: Headers }> {
    checkRepository(repository)
    const path = request.path.map(segment)
    const query = new URLSearchParams(stringValues(request.query ?? {}))
    const search = query.size === 0 ? '' : `?${query.toString()}`
    const url = `${repositoryUrl(repository)}${path.map((s) => `/${s}`).join('')}${search}`

    const { token, answer } = await exchange(fn, repository, request.method, url, request.body)
    const refused = await refusal(fn, repository, token, answer, path.length === 0)
    if (refused !== undefined) throw refused
    if (answer.invalid) {
      throw new GitHubRequestError(
        fn,
        via(fn),
        repository,
        `GitHub answered ${answer.status} without JSON`,
        {
          status: answer.status,
        },
      )
    }
    return { status: answer.status, data: answer.json, headers: answer.headers }
  }

  return {
    via,

    async rest(fn, repository, request) {
      const { status, data } = await call(fn, repository, request)
      return { status, data }
    },

    async restPages(fn, repository, request) {
      const items: unknown[] = []
      const asked = new Set<string>()
      let query: Record<string, string | number | boolean> = { ...request.query }
      for (;;) {
        asked.add(new URLSearchParams(stringValues(query)).toString())
        const { data, headers } = await call(fn, repository, { ...request, method: 'GET', query })
        if (!Array.isArray(data)) {
          throw new GitHubRequestError(
            fn,
            via(fn),
            repository,
            'GitHub answered a page that is not a list',
          )
        }
        items.push(...data)
        const next = nextPage(headers.get('link'))
        if (next === undefined) return items
        // Only the next page's query is taken from GitHub's link; the path stays the request's, so
        // the link cannot lead the call, and its credential, elsewhere.
        query = { ...request.query, ...Object.fromEntries(next) }
        if (asked.has(new URLSearchParams(stringValues(query)).toString())) {
          throw new GitHubRequestError(
            fn,
            via(fn),
            repository,
            "GitHub's next page is one already read",
          )
        }
      }
    },

    async graphql(fn, repository, query, variables = {}) {
      checkRepository(repository)
      const { token, answer } = await exchange(fn, repository, 'POST', `${apiUrl}/graphql`, {
        query,
        variables,
      })
      const refused = await refusal(fn, repository, token, answer, false)
      if (refused !== undefined) throw refused
      const errors = graphqlErrors(answer.json)
      if (errors.length > 0) {
        const summary = errors
          .map((e) => (e.type === undefined ? e.message : `${e.type}: ${e.message}`))
          .join('; ')
        if (errors.some((e) => e.type === 'FORBIDDEN')) {
          throw new GitHubUnreachableError(fn, via(fn), repository, summary)
        }
        if (errors.some((e) => e.type === 'NOT_FOUND')) {
          const notShown = await unreachable(fn, repository, token)
          if (notShown !== undefined) throw notShown
        }
        throw new GitHubRequestError(fn, via(fn), repository, summary, {
          status: answer.status,
          graphqlErrors: errors,
        })
      }
      const data = field(answer.json, 'data')
      if (answer.invalid || typeof data !== 'object' || data === null) {
        throw new GitHubRequestError(fn, via(fn), repository, 'GitHub answered without data', {
          status: answer.status,
        })
      }
      return data
    },
  }
}

/** A path segment, encoded; `.` and `..`, which would leave the repository's path, are refused. */
function segment(value: string | number): string {
  const text = String(value)
  if (text === '' || text === '.' || text === '..') {
    throw new TypeError(`${JSON.stringify(text)} is not a path segment of a GitHub repository`)
  }
  return encodeURIComponent(text)
}

/**
 * A primary or secondary rate limit, which is not a refusal of access. GitHub may answer a
 * secondary one with neither header, so its message is read too.
 */
function rateLimited(answer: Answer): boolean {
  const message = field(answer.json, 'message')
  return (
    answer.headers.get('x-ratelimit-remaining') === '0' ||
    answer.headers.has('retry-after') ||
    (typeof message === 'string' && /rate limit/i.test(message))
  )
}

/** GitHub's message, which says why and holds no secret, as ` (message)`. */
function gitHubMessage(answer: Answer): string {
  const message = field(answer.json, 'message')
  return typeof message === 'string' ? ` (${message})` : ''
}

function graphqlErrors(json: unknown): GitHubGraphQLError[] {
  const errors = field(json, 'errors')
  if (!Array.isArray(errors)) return []
  return errors.map((e: unknown) => {
    const type = field(e, 'type')
    const message = field(e, 'message')
    return {
      ...(typeof type === 'string' ? { type } : {}),
      message: typeof message === 'string' ? message : 'GitHub gave no message',
    }
  })
}

/** The query of the `next` page in a `link` header, if there is one. */
function nextPage(link: string | null): URLSearchParams | undefined {
  if (link === null) return undefined
  for (const part of link.split(',')) {
    const match = /^\s*<([^>]*)>\s*;(.*)$/.exec(part)
    if (match === null || !/\brel="?next"?/.test(match[2] ?? '')) continue
    try {
      return new URL(match[1] ?? '').searchParams
    } catch {
      return undefined
    }
  }
  return undefined
}

function stringValues(
  query: Readonly<Record<string, string | number | boolean>>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]))
}

function field(json: unknown, name: string): unknown {
  if (typeof json !== 'object' || json === null) return undefined
  const value: unknown = Reflect.get(json, name)
  return value
}
