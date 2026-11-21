import type { LiveSettings } from './settings.ts'

export interface Task {
  id: string
  projectId: string
  title: string
  status: 'not-started' | 'in-progress' | 'on-hold' | 'done' | 'cancelled'
  plannedStart: string | null
  plannedFinish: string | null
  assignees: string[]
  actualStart: string | null
  actualFinish: string | null
  repositoryId: string | null
  githubIssue: { repositoryId: string; number: number } | null
}

/** An answer of the deployment's REST API that was not what the call expected. */
export class ToolError extends Error {}

/**
 * The deployment's REST API, called as its first system admin with an API token the suite creates
 * when it signs in and deletes when it is done, so its calls go through the REST API channel.
 */
export class Tool {
  readonly #url: string
  readonly #secret: string
  readonly #tokenId: string
  readonly accountId: string

  private constructor(url: string, secret: string, tokenId: string, accountId: string) {
    this.#url = url
    this.#secret = secret
    this.#tokenId = tokenId
    this.accountId = accountId
  }

  static async signIn(settings: LiveSettings): Promise<Tool> {
    const signedIn = await fetch(`${settings.url}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings.admin),
    })
    if (signedIn.status !== 204) {
      throw new ToolError(`Signing in as ${settings.admin.username} answered ${signedIn.status}`)
    }
    const cookie = signedIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const asSession = (method: string, path: string, body?: unknown) =>
      fetch(`${settings.url}${path}`, {
        method,
        headers: {
          cookie,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    const expiresAt = new Date(Date.now() + 24 * 3600_000).toISOString()
    const created = await asSession('POST', '/api/tokens', { expiresAt })
    if (created.status !== 201) throw new ToolError(`Creating a token answered ${created.status}`)
    const { token, secret }: { token: { id: string }; secret: string } = JSON.parse(
      await created.text(),
    )
    const me: { id: string } = JSON.parse(await (await asSession('GET', '/api/session')).text())
    await asSession('DELETE', '/api/session')
    return new Tool(settings.url, secret, token.id, me.id)
  }

  /** Calls the REST API, and returns its answer's body if its status is `expected`. */
  async call<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    expected: number | number[] = [200, 201, 204],
  ): Promise<T> {
    const response = await fetch(`${this.#url}/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.#secret}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (![expected].flat().includes(response.status)) {
      throw new ToolError(`${method} /api${path} answered ${response.status}: ${text}`)
    }
    const parsed: T = text === '' ? undefined : JSON.parse(text)
    return parsed
  }

  task(taskId: string): Promise<Task> {
    return this.call<Task>('GET', `/tasks/${taskId}`)
  }

  /** Deletes the suite's API token: nothing the suite signed in with outlives it. */
  async signOut(): Promise<void> {
    await this.call('DELETE', `/tokens/${this.#tokenId}`)
  }
}
