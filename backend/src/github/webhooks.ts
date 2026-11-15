import { createHmac, timingSafeEqual } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import type { Config } from '../config/config.ts'
import type { Database } from '../db/client.ts'
import { repositories } from '../db/schema.ts'
import type { Repository } from './app-tokens.ts'
import type { GitHubChangeHandler } from './change-handler.ts'
import type { GitHubClient } from './client.ts'
import { numberField, objectField, stringField } from './json.ts'

/** The headers of a delivery the receiver reads, by their lower-case names. */
export interface WebhookHeaders {
  /** The event, such as `issues` (`X-GitHub-Event`). */
  event: string | undefined
  /** `sha256=` and the HMAC of the body under the webhook secret (`X-Hub-Signature-256`). */
  signature: string | undefined
  /**
   * Where the webhook was set up (`X-GitHub-Hook-Installation-Target-Type`): `integration` for a
   * GitHub App, `repository` or `organization` for a webhook set up there.
   */
  targetType: string | undefined
  /** The App's id, for an App's webhook (`X-GitHub-Hook-Installation-Target-ID`). */
  targetId: string | undefined
}

/** Why a delivery was rejected; `accepted` if it was not. */
export type WebhookVerdict = 'accepted' | 'no-secret' | 'bad-signature'

/** The webhook secrets, as the configuration gives them (DD-058, DD-060). */
export type WebhookSecrets = Pick<Config['github'], 'apps' | 'webhookSecret'>

/**
 * Checks a delivery's signature against the secret configured for whoever sent it (SC-105): for
 * a GitHub App's webhook, the secret given with that App (an App given for several functions may
 * be given a secret with each, and any of them is taken); for a repository's or an organization's
 * webhook, the one secret of those webhooks. A delivery from an App with no secret configured, or
 * from a repository or organization webhook while none is configured, or from anything else, is
 * rejected as `no-secret`; one whose signature does not match, as `bad-signature`.
 */
export function verifyDelivery(
  secrets: WebhookSecrets,
  headers: Pick<WebhookHeaders, 'signature' | 'targetType' | 'targetId'>,
  body: Buffer,
): WebhookVerdict {
  const candidates = secretsFor(secrets, headers)
  if (candidates.length === 0) return 'no-secret'
  const signature = headers.signature ?? ''
  const given = Buffer.from(signature)
  for (const secret of candidates) {
    const expected = Buffer.from(
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    )
    if (given.length === expected.length && timingSafeEqual(given, expected)) return 'accepted'
  }
  return 'bad-signature'
}

function secretsFor(
  secrets: WebhookSecrets,
  headers: Pick<WebhookHeaders, 'targetType' | 'targetId'>,
): string[] {
  if (headers.targetType === 'integration') {
    const appId = Number(headers.targetId)
    const found = Object.values(secrets.apps).flatMap((app) =>
      app !== undefined && app.appId === appId && app.webhookSecret !== undefined
        ? [app.webhookSecret]
        : [],
    )
    return [...new Set(found)]
  }
  if (headers.targetType === 'repository' || headers.targetType === 'organization') {
    return secrets.webhookSecret === undefined ? [] : [secrets.webhookSecret]
  }
  return []
}

const ISSUE_OF_NODE = `query ($id: ID!) {
  node(id: $id) { ... on Issue { number repository { name owner { login } } } }
}`

export interface WebhookReceiverOptions {
  /** Told of each accepted delivery the change handler could not take in. */
  onError?: (error: unknown, event: string) => void
}

/**
 * The GitHub webhook receiver behind the webhook endpoint (SC-105): it checks each delivery's
 * signature (`verifyDelivery`) and hands each accepted one to the GitHub change handler (SC-023):
 *
 * - `issues`: an issue opened, as `issueOpened`; any other action on an issue, as `issueChanged`;
 * - `sub_issues` and `issue_dependencies`: each issue the delivery names, as `issueChanged`, so
 *   that the planning edit is undone (FR-097);
 * - `projects_v2_item`: the issue whose item changed, found by its node id through a registered
 *   repository of the Project's organization, as `issueChanged`.
 *
 * Each is handed on with the delivery's sender. Any other event, and a delivery about a pull
 * request, is accepted with no effect. The handler's work is done in the background, so that the
 * delivery is answered at once; what fails is told to `onError`, for the re-check to put right.
 */
export class GitHubWebhookReceiver {
  readonly #db: Database
  readonly #secrets: WebhookSecrets
  readonly #handler: Pick<GitHubChangeHandler, 'issueChanged' | 'issueOpened'>
  readonly #github: () => GitHubClient
  readonly #onError: (error: unknown, event: string) => void
  readonly #pending = new Set<Promise<void>>()

  constructor(
    db: Database,
    secrets: WebhookSecrets,
    handler: Pick<GitHubChangeHandler, 'issueChanged' | 'issueOpened'>,
    github: () => GitHubClient,
    options: WebhookReceiverOptions = {},
  ) {
    this.#db = db
    this.#secrets = secrets
    this.#handler = handler
    this.#github = github
    this.#onError = options.onError ?? (() => {})
  }

  /**
   * Checks the delivery and, if it is accepted, starts handing it to the change handler. A
   * rejected delivery has no effect.
   */
  receive(headers: WebhookHeaders, body: Buffer, payload: unknown): WebhookVerdict {
    const verdict = verifyDelivery(this.#secrets, headers, body)
    if (verdict !== 'accepted') return verdict
    const event = headers.event ?? ''
    const work = this.#dispatch(event, payload).catch((error: unknown) =>
      this.#onError(error, event),
    )
    this.#pending.add(work)
    void work.finally(() => this.#pending.delete(work))
    return verdict
  }

  /** Resolves once every accepted delivery has been handed on and handled, or has failed. */
  async idle(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all(this.#pending)
  }

  async #dispatch(event: string, payload: unknown): Promise<void> {
    const sender = stringField(objectField(payload, 'sender'), 'login')
    if (event === 'issues') {
      const raw = objectField(payload, 'issue')
      const issue = issueIn(raw)
      if (issue === undefined) return
      if (stringField(payload, 'action') === 'opened') {
        // GitHub always names the sender; its author opened it otherwise.
        const author = stringField(objectField(raw, 'user'), 'login') ?? ''
        await this.#handler.issueOpened(issue.repository, issue.number, sender ?? author)
      } else {
        await this.#handler.issueChanged(issue.repository, issue.number, sender)
      }
      return
    }
    if (event === 'sub_issues' || event === 'issue_dependencies') {
      const named = typeof payload === 'object' && payload !== null ? Object.values(payload) : []
      for (const value of named) {
        const issue = issueIn(value)
        if (issue !== undefined) {
          await this.#handler.issueChanged(issue.repository, issue.number, sender)
        }
      }
      return
    }
    if (event === 'projects_v2_item') {
      const item = objectField(payload, 'projects_v2_item')
      if (stringField(item, 'content_type') !== 'Issue') return
      const nodeId = stringField(item, 'content_node_id')
      const organization = stringField(objectField(payload, 'organization'), 'login')
      if (nodeId === undefined || organization === undefined) return
      const issue = await this.#issueOfNode(organization, nodeId)
      if (issue !== undefined) {
        await this.#handler.issueChanged(issue.repository, issue.number, sender)
      }
    }
  }

  /**
   * The issue of a Project item, by its node id. GitHub is asked through a registered repository
   * of the organization, since every call is made on a repository; none, and nothing is asked.
   */
  async #issueOfNode(
    organization: string,
    nodeId: string,
  ): Promise<{ repository: Repository; number: number } | undefined> {
    const [through] = await this.#db
      .select({ owner: repositories.owner, name: repositories.name })
      .from(repositories)
      .where(eq(sql`lower(${repositories.owner})`, organization.toLowerCase()))
      .limit(1)
    if (through === undefined) return undefined
    const answer = await this.#github().graphql('readIssues', through, ISSUE_OF_NODE, {
      id: nodeId,
    })
    const node = objectField(answer, 'node')
    const number = numberField(node, 'number')
    const repository = objectField(node, 'repository')
    const owner = stringField(objectField(repository, 'owner'), 'login')
    const name = stringField(repository, 'name')
    if (number === undefined || owner === undefined || name === undefined) return undefined
    return { repository: { owner, name }, number }
  }
}

/**
 * An issue a delivery names: an object with its number and the API address of its repository,
 * `https://api.github.com/repos/<owner>/<name>`; not a pull request.
 */
function issueIn(value: unknown): { repository: Repository; number: number } | undefined {
  const number = numberField(value, 'number')
  const url = stringField(value, 'repository_url')
  if (number === undefined || url === undefined) return undefined
  if (objectField(value, 'pull_request') !== undefined) return undefined
  const match = /\/repos\/([^/]+)\/([^/]+)\/?$/.exec(url)
  if (!match) return undefined
  return {
    repository: {
      owner: decodeURIComponent(match[1] ?? ''),
      name: decodeURIComponent(match[2] ?? ''),
    },
    number,
  }
}
