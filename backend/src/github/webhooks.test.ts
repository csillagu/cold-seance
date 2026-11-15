import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { GitHubAppConfig } from '../config/config.ts'
import { createDatabase } from '../db/client.ts'
import type { GitHubChangeHandler } from './change-handler.ts'
import type { GitHubClient } from './client.ts'
import { GitHubWebhookReceiver, verifyDelivery, type WebhookSecrets } from './webhooks.ts'

// The webhook receiver's signature check and what it hands the change handler (SC-105). The
// Projects item lookup, which asks the database and GitHub, is tested in
// test/integration/github-sync.test.ts.

type Changed = GitHubChangeHandler['issueChanged']
type Opened = GitHubChangeHandler['issueOpened']

// Never asked: none of these deliveries is a Projects item of an issue.
const { db } = createDatabase('postgres://nobody@unused.invalid/none')
const github = (): GitHubClient => {
  throw new Error('GitHub is not asked in these tests')
}

const appWith = (appId: number, webhookSecret: string | undefined): GitHubAppConfig => ({
  appId,
  privateKeyFile: '/run/secrets/app.pem',
  privateKey: 'unused',
  webhookSecret,
})

const sign = (secret: string, body: Buffer) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

const body = Buffer.from('{"zen":"Keep it logically awesome."}')
const fromApp = (appId: number, signature?: string) => ({
  signature,
  targetType: 'integration',
  targetId: String(appId),
})
const fromRepository = (signature?: string, targetType = 'repository') => ({
  signature,
  targetType,
  targetId: '1',
})

describe('verifyDelivery', () => {
  const secrets: WebhookSecrets = {
    apps: {
      readIssues: appWith(1, 'read-secret'),
      writeIssues: appWith(2, undefined),
      projectsStatus: appWith(1, 'status-secret'),
    },
    webhookSecret: 'repository-secret',
  }

  it("accepts a delivery signed with the secret of the App that sent it, any of an App's secrets", () => {
    expect(verifyDelivery(secrets, fromApp(1, sign('read-secret', body)), body)).toBe('accepted')
    expect(verifyDelivery(secrets, fromApp(1, sign('status-secret', body)), body)).toBe('accepted')
  })

  it("rejects a delivery signed with another App's or the repository webhooks' secret", () => {
    expect(verifyDelivery(secrets, fromApp(1, sign('repository-secret', body)), body)).toBe(
      'bad-signature',
    )
    expect(verifyDelivery(secrets, fromRepository(sign('read-secret', body)), body)).toBe(
      'bad-signature',
    )
  })

  it('rejects an unsigned delivery, and one whose body is not what was signed', () => {
    expect(verifyDelivery(secrets, fromApp(1), body)).toBe('bad-signature')
    expect(
      verifyDelivery(secrets, fromApp(1, sign('read-secret', body)), Buffer.from('{"zen":""}')),
    ).toBe('bad-signature')
    expect(verifyDelivery(secrets, fromApp(1, 'sha256=00'), body)).toBe('bad-signature')
  })

  it('rejects a delivery from an App with no secret configured, or an App it does not know', () => {
    expect(verifyDelivery(secrets, fromApp(2, sign('read-secret', body)), body)).toBe('no-secret')
    expect(verifyDelivery(secrets, fromApp(3, sign('read-secret', body)), body)).toBe('no-secret')
  })

  it('accepts repository and organization webhooks signed with their one secret', () => {
    const signature = sign('repository-secret', body)
    expect(verifyDelivery(secrets, fromRepository(signature), body)).toBe('accepted')
    expect(verifyDelivery(secrets, fromRepository(signature, 'organization'), body)).toBe(
      'accepted',
    )
  })

  it('rejects repository and organization webhooks while no secret is configured for them', () => {
    const none = { ...secrets, webhookSecret: undefined }
    expect(verifyDelivery(none, fromRepository(sign('repository-secret', body)), body)).toBe(
      'no-secret',
    )
  })

  it('rejects a delivery from anything else', () => {
    const signature = sign('repository-secret', body)
    expect(verifyDelivery(secrets, fromRepository(signature, 'business'), body)).toBe('no-secret')
    expect(
      verifyDelivery(secrets, { signature, targetType: undefined, targetId: undefined }, body),
    ).toBe('no-secret')
  })
})

describe('GitHubWebhookReceiver', () => {
  const secret = 'repository-secret'
  const repoUrl = 'https://api.github.com/repos/Acme/Widgets'

  function receiver() {
    const handler = {
      issueChanged: vi.fn<Changed>(async () => {}),
      issueOpened: vi.fn<Opened>(async () => {}),
    }
    const r = new GitHubWebhookReceiver(db, { apps: {}, webhookSecret: secret }, handler, github)
    const deliver = async (event: string, payload: unknown, signed = true) => {
      const raw = Buffer.from(JSON.stringify(payload))
      const verdict = r.receive(
        { event, ...fromRepository(signed ? sign(secret, raw) : undefined) },
        raw,
        payload,
      )
      await r.idle()
      return verdict
    }
    return { handler, deliver }
  }

  const sender = { login: 'tc-writer' }

  it('hands an opened issue to issueOpened and any other issue action to issueChanged', async () => {
    const { handler, deliver } = receiver()
    await deliver('issues', {
      action: 'opened',
      issue: { number: 4, repository_url: repoUrl },
      sender,
    })
    await deliver('issues', {
      action: 'reopened',
      issue: { number: 5, repository_url: repoUrl },
      sender,
    })
    const repository = { owner: 'Acme', name: 'Widgets' }
    expect(handler.issueOpened.mock.calls).toEqual([[repository, 4, 'tc-writer']])
    expect(handler.issueChanged.mock.calls).toEqual([[repository, 5, 'tc-writer']])
  })

  it('hands each issue a sub-issue or dependency delivery names to issueChanged', async () => {
    const { handler, deliver } = receiver()
    const other = 'https://api.github.com/repos/Acme/Gadgets'
    await deliver('sub_issues', {
      action: 'sub_issue_added',
      parent_issue: { number: 1, repository_url: repoUrl },
      sub_issue: { number: 2, repository_url: other },
      repository: { name: 'Widgets', owner: { login: 'Acme' } },
      sender,
    })
    await deliver('issue_dependencies', {
      action: 'blocked_by_added',
      blocked_issue: { number: 3, repository_url: repoUrl },
      blocking_issue: { number: 1, repository_url: repoUrl },
      sender,
    })
    expect(handler.issueChanged.mock.calls).toEqual([
      [{ owner: 'Acme', name: 'Widgets' }, 1, 'tc-writer'],
      [{ owner: 'Acme', name: 'Gadgets' }, 2, 'tc-writer'],
      [{ owner: 'Acme', name: 'Widgets' }, 3, 'tc-writer'],
      [{ owner: 'Acme', name: 'Widgets' }, 1, 'tc-writer'],
    ])
  })

  it('accepts other events, pull requests and Project items of pull requests with no effect', async () => {
    const { handler, deliver } = receiver()
    expect(await deliver('ping', { zen: 'Design for failure.', sender })).toBe('accepted')
    await deliver('issues', {
      action: 'closed',
      issue: { number: 6, repository_url: repoUrl, pull_request: {} },
      sender,
    })
    await deliver('projects_v2_item', {
      action: 'edited',
      projects_v2_item: { content_node_id: 'PR_1', content_type: 'PullRequest' },
      organization: { login: 'Acme' },
      sender,
    })
    expect(handler.issueChanged).not.toHaveBeenCalled()
    expect(handler.issueOpened).not.toHaveBeenCalled()
  })

  it('hands on nothing of a rejected delivery', async () => {
    const { handler, deliver } = receiver()
    const verdict = await deliver(
      'issues',
      { action: 'closed', issue: { number: 1, repository_url: repoUrl }, sender },
      false,
    )
    expect(verdict).toBe('bad-signature')
    expect(handler.issueChanged).not.toHaveBeenCalled()
  })

  it('tells onError of a delivery the handler could not take in', async () => {
    const failure = new Error('GitHub cannot be reached')
    const onError = vi.fn<(error: unknown, event: string) => void>()
    const handler = {
      issueChanged: vi.fn<Changed>(async () => Promise.reject(failure)),
      issueOpened: vi.fn<Opened>(),
    }
    const r = new GitHubWebhookReceiver(db, { apps: {}, webhookSecret: secret }, handler, github, {
      onError,
    })
    const payload = { action: 'closed', issue: { number: 1, repository_url: repoUrl }, sender }
    const raw = Buffer.from(JSON.stringify(payload))
    expect(r.receive({ event: 'issues', ...fromRepository(sign(secret, raw)) }, raw, payload)).toBe(
      'accepted',
    )
    await r.idle()
    expect(onError).toHaveBeenCalledWith(failure, 'issues')
  })
})
