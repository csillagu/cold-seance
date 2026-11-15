import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { taskIssues } from '../../src/db/schema.ts'
import { GitHubChangeHandler } from '../../src/github/change-handler.ts'
import { GitHubPlanningMirror } from '../../src/github/planning-mirror.ts'
import { GitHubRevertCommenter } from '../../src/github/revert-commenter.ts'
import type { Caller } from '../../src/service/caller.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import type { FakeIssue } from '../helpers/github-issues.ts'
import { grantRole } from '../helpers/projects.ts'

// The GitHub revert commenter (SC-062) against a real PostgreSQL and a fake GitHub, with the
// change handler (SC-023) and the planning mirror (SC-022) that make the reverts. As in
// change-handler.test.ts, the test cases' "as tc-writer, ..." steps are made on the fake GitHub
// directly, and the handler is then fed the change, as the webhook endpoint and the re-check
// (SC-105, SC-024) feed it; github-sync.test.ts shows those bring a change in within the hour.
// The test cases' in-app notifications are read through the REST API, as the in-app list reads
// them (SC-035).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

interface Deployment {
  x: TestDatabase
  github: FakeGitHub
  mirror: GitHubPlanningMirror
  handler: GitHubChangeHandler
  services: Services
  app: ReturnType<typeof buildApp>
  errors: unknown[]
  alice: Seeded
}

interface Setup {
  projectId: string
  repo: RegisteredRepository
  full: string
}

let n = 0

describe('GitHub revert commenter', () => {
  let d: Deployment

  beforeEach(async () => {
    const x = await createTestDatabase()
    const github = fakeGitHub()
    const errors: unknown[] = []
    const reverts = new GitHubRevertCommenter(x.db, github.client, {
      onError: (error) => errors.push(error),
    })
    const mirror = new GitHubPlanningMirror(x.db, github.client, {
      onError: (error) => errors.push(error),
      reverts,
    })
    const services = createServices(x.db, { github: github.reach, planningChanges: mirror })
    const handler = new GitHubChangeHandler(x.db, github.client, mirror, services, { reverts })
    const app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    const alice = await seedAccount(x.db, { username: 'alice' })
    d = { x, github, mirror, handler, services, app, errors, alice }
  })

  afterEach(async () => {
    await d?.mirror.idle()
    await d?.app.close()
    await d?.x.drop()
  })

  /** tc-repo, registered by alice and added to project Apollo, created by alice. */
  async function apolloWithRepo(): Promise<Setup> {
    const full = `csillagu/tc-repo-${++n}`
    const [owner = '', name = ''] = full.split('/')
    d.github.createRepository(full)
    const repo = await d.services.repositories.registerRepository(by(d.alice), { owner, name })
    const project = await d.services.projects.createProject(by(d.alice), { name: `Apollo ${n}` })
    await d.services.projectRepositories.requestRepository(by(d.alice), project.id, repo.id)
    return { projectId: project.id, repo, full }
  }

  /** A task of Apollo assigned to tc-repo, with its issue on GitHub linked to it. */
  async function linked(s: Setup, title: string): Promise<{ id: string; issue: FakeIssue }> {
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, { title })
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    const [link] = await d.x.db.select().from(taskIssues).where(eq(taskIssues.taskId, task.id))
    if (!link) throw new Error('The task has no issue')
    return { id: task.id, issue: d.github.issues.issue(s.full, link.number) }
  }

  /** Tasks A (in progress) and B (not started, blocked by A), with issues #1 and #2. */
  async function aBlocksB(s: Setup) {
    const a = await linked(s, 'A')
    const b = await linked(s, 'B')
    await d.services.taskStatus.setStatus(by(d.alice), a.id, 'in-progress')
    await d.services.taskRelations.addBlocker(by(d.alice), b.id, a.id)
    await d.mirror.idle()
    expect([a.issue.number, b.issue.number]).toEqual([1, 2])
    return { a, b }
  }

  /** Feeds the handler the change tc-writer made to the issue, and waits for the mirror. */
  async function changed(s: Setup, number: number): Promise<void> {
    const [owner = '', name = ''] = s.full.split('/')
    await d.handler.issueChanged({ owner, name }, number, 'tc-writer')
    await d.mirror.idle()
  }

  /** `who`'s in-app notifications, as the REST API gives them. */
  async function notificationsOf(who: Seeded) {
    const response = await d.app.inject({
      method: 'GET',
      url: '/api/notifications',
      headers: as(who),
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ kind: string; createdAt: string; detail: Record<string, unknown> }[]>()
  }

  const close = (issue: FakeIssue) => {
    issue.state = 'closed'
    issue.stateReason = 'completed'
  }

  it('TC-144: a revert on GitHub leaves a comment explaining why', async () => {
    const s = await apolloWithRepo()
    const { a, b } = await aBlocksB(s)
    expect(b.issue.comments).toEqual([])

    // Step 1: as tc-writer, close #2.
    close(b.issue)
    await changed(s, 2)

    // Step 2: #2 is reopened, and has one new comment, posted by the tool, saying the close was
    // reverted because #2 is blocked by #1, which is not finished.
    expect(b.issue.state).toBe('open')
    expect(b.issue.comments).toEqual([
      'This issue was reopened, as its task cannot be finished yet: it is blocked by #1, ' +
        'which is not finished.',
    ])
    // No comment is posted on #1.
    expect(a.issue.comments).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('TC-121: a change reverted on GitHub notifies the project’s subscribers', async () => {
    const bob = await seedAccount(d.x.db, { username: 'bob' })
    const s = await apolloWithRepo()
    await grantRole(d.x.db, bob, s.projectId, 'read-only')
    await d.services.notifications.subscribeToProject(by(bob), s.projectId)
    // alice's account is not linked to GitHub, so #1 has no assignees.
    const t = await linked(s, 'T')
    await d.services.tasks.updateTask(by(d.alice), t.id, { assignees: [d.alice.id] })
    await d.mirror.idle()
    expect(t.issue.assignees).toEqual([])

    // Step 1, the trigger: tc-writer adds tc-writer as an assignee of #1 on GitHub.
    t.issue.assignees = ['tc-writer']
    await changed(s, 1)

    // Step 2: #1's assignees are restored, and bob has a notification of the reverted change on
    // #1. The notification is in the app; the tool has no other channel to send it by (FR-082).
    expect(t.issue.assignees).toEqual([])
    const [owner, name] = s.full.split('/')
    expect(await notificationsOf(bob)).toEqual([
      expect.objectContaining({
        kind: 'github-revert',
        detail: {
          task: { id: t.id, projectId: s.projectId },
          repository: { id: s.repo.id, owner, name },
          number: 1,
          change: 'planning',
          parts: ['assignees'],
        },
      }),
    ])
    expect(t.issue.comments).toEqual([
      "This issue's assignees were set back to match its task: the plan is kept in the tool, " +
        'and is changed there.',
    ])
    expect(d.errors).toEqual([])
  })

  it('TC-234: a subscriber to an issue is notified of a revert on it within an hour', async () => {
    const carol = await seedAccount(d.x.db, { username: 'carol' })
    const s = await apolloWithRepo()
    await grantRole(d.x.db, carol, s.projectId, 'read-only')
    const { b } = await aBlocksB(s)
    await d.services.notifications.subscribeToIssue(by(carol), b.id)

    // Step 1: as tc-writer, close #2 at time t.
    const t = Date.now()
    close(b.issue)
    await changed(s, 2)

    // Step 2: carol has a notification that the close of #2 was reverted, which did not arrive
    // later than t + 60 minutes.
    const found = await notificationsOf(carol)
    expect(found).toEqual([
      expect.objectContaining({
        kind: 'github-revert',
        detail: expect.objectContaining({
          task: { id: b.id, projectId: s.projectId },
          number: 2,
          change: 'close',
        }),
      }),
    ])
    expect(Date.parse(found[0]?.createdAt ?? '')).toBeLessThanOrEqual(t + 60 * 60 * 1000)
    expect(d.errors).toEqual([])
  })

  it('TC-235: a subscriber to one issue gets no notification about another', async () => {
    const carol = await seedAccount(d.x.db, { username: 'carol' })
    const s = await apolloWithRepo()
    await grantRole(d.x.db, carol, s.projectId, 'read-only')
    const { b } = await aBlocksB(s)
    const c = await linked(s, 'C')
    expect(c.issue.number).toBe(3)
    await d.services.notifications.subscribeToIssue(by(carol), c.id)
    const before = await d.services.notifications.subscriptionsOf(by(carol))

    // Step 1: as tc-writer, close #2.
    close(b.issue)
    await changed(s, 2)

    // Step 2: once #2 is reopened, carol has no notification about #2.
    expect(b.issue.state).toBe('open')
    expect(await notificationsOf(carol)).toEqual([])
    // carol's subscription to #3 is unchanged.
    expect(await d.services.notifications.subscriptionsOf(by(carol))).toEqual(before)
    expect(d.errors).toEqual([])
  })

  describe('the comment for each kind of revert (FR-098)', () => {
    it('explains a reset start, naming the blocker', async () => {
      const s = await apolloWithRepo()
      const { b } = await aBlocksB(s)
      const item = d.github.issues.addToProject(s.full, 2, { status: 'Todo' })
      await changed(s, 2)

      item.status = 'In Progress'
      await changed(s, 2)

      expect(item.status).toBe('Todo')
      expect(b.issue.comments).toEqual([
        "This issue's move to the started status was undone, as its task cannot be started " +
          'yet: it is blocked by #1, which is not finished.',
      ])
    })

    it('explains a re-created issue on the new one, naming the deleted one', async () => {
      const s = await apolloWithRepo()
      const { b } = await aBlocksB(s)

      d.github.issues.deleteIssue(s.full, 2)
      await changed(s, 2)

      const [link] = await d.x.db.select().from(taskIssues).where(eq(taskIssues.taskId, b.id))
      const recreated = d.github.issues.issue(s.full, link?.number ?? 0)
      // Its planning, given to the new issue, is no revert of its own.
      expect(recreated.comments).toEqual([
        'This issue was created again in place of #2, which was deleted, as its task cannot be ' +
          'finished yet: it is blocked by #1, which is not finished.',
      ])
    })

    it('explains a close reopened for an open subtask, naming it', async () => {
      const s = await apolloWithRepo()
      const p = await linked(s, 'P')
      const c = await linked(s, 'C')
      await d.services.taskRelations.setParent(by(d.alice), c.id, p.id)
      await d.mirror.idle()

      close(p.issue)
      await changed(s, 1)

      expect(p.issue.comments).toEqual([
        'This issue was reopened, as its task cannot be finished yet: it has a subtask still ' +
          'open: #2.',
      ])
      expect(c.issue.comments).toEqual([])
    })

    it('explains a reopening closed again, naming the blocker', async () => {
      const s = await apolloWithRepo()
      const { a, b } = await aBlocksB(s)
      // B was finished before A blocked it, and never started.
      await d.services.taskRelations.removeBlocker(by(d.alice), b.id, a.id)
      await d.services.taskStatus.setStatus(by(d.alice), b.id, 'done')
      await d.services.taskRelations.addBlocker(by(d.alice), b.id, a.id)
      await d.mirror.idle()
      close(b.issue)
      await changed(s, 2)
      expect(b.issue.comments).toEqual([])

      b.issue.state = 'open'
      b.issue.stateReason = null
      await changed(s, 2)

      expect(b.issue.state).toBe('closed')
      expect(b.issue.comments).toEqual([
        'This issue was closed again, as its task cannot be set back in progress: it is ' +
          'blocked by #1, which is not finished.',
      ])
    })

    it('makes no comment, and notifies no one, for a change taken in', async () => {
      const bob = await seedAccount(d.x.db, { username: 'bob' })
      const s = await apolloWithRepo()
      await grantRole(d.x.db, bob, s.projectId, 'read-write')
      const t = await linked(s, 'T')

      close(t.issue)
      await changed(s, 1)

      expect(t.issue.comments).toEqual([])
      expect(await notificationsOf(bob)).toEqual([])
    })

    it('makes no comment for a change made in the tool', async () => {
      const s = await apolloWithRepo()
      const { a, b } = await aBlocksB(s)
      await d.services.taskRelations.removeBlocker(by(d.alice), b.id, a.id)
      await d.mirror.idle()

      expect(b.issue.blockedBy).toEqual([])
      expect(b.issue.comments).toEqual([])
    })
  })

  it('notifies a read-write member of a revert in their project, by their role (FR-134)', async () => {
    const bob = await seedAccount(d.x.db, { username: 'bob' })
    const s = await apolloWithRepo()
    await grantRole(d.x.db, bob, s.projectId, 'read-write')
    const { b } = await aBlocksB(s)

    close(b.issue)
    await changed(s, 2)

    expect((await notificationsOf(bob)).map((x) => x.detail['change'])).toEqual(['close'])
  })
})
