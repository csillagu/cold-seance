import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { taskBlockedBy, taskIssues, tasks } from '../../src/db/schema.ts'
import { GitHubChangeHandler } from '../../src/github/change-handler.ts'
import { GitHubPlanningMirror } from '../../src/github/planning-mirror.ts'
import type { Caller } from '../../src/service/caller.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { seedAccount } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import type { FakeIssue } from '../helpers/github-issues.ts'

// The GitHub change handler (SC-023) against a real PostgreSQL and a fake GitHub. The test cases'
// "as tc-writer, ..." steps are made on the fake GitHub directly, and the handler is then fed the
// change, as the webhook endpoint and the re-check (SC-105, SC-024: B17) will feed it; the tests
// wait for the planning mirror (SC-022) to be idle, well within the hour the test cases allow.
// Each task gets its issue as the test cases' "so it has issue #1" describes: it is assigned to
// the repository, and the GitHub issue creator (SC-060) opens it.
//
// Pending: TC-131, TC-132 and TC-146, starting and holding from the Projects status field
// (FR-091, FR-092, FR-099), and TC-136, a start on a blocked task reset (FR-095): which status
// field and values mean started and on hold waits for the owner (#116, #122).
// Pending: TC-133, TC-134, TC-135, TC-140, TC-145 and TC-201, a finish, reopen, cancel or delete
// taken from GitHub (FR-093, FR-094, FR-096, FR-099, FR-136); TC-147, TC-228, TC-229 and
// TC-212 steps 2 and 3, new issues becoming unscheduled tasks (FR-100, FR-156, FR-157); and
// TC-173 in full: each is a change in the tool, which the audit log records with who made it
// (FR-116), and how a GitHub user with no account in the tool is recorded there waits for the
// owner (#122).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

interface Deployment {
  x: TestDatabase
  github: FakeGitHub
  mirror: GitHubPlanningMirror
  handler: GitHubChangeHandler
  services: Services
  errors: unknown[]
  alice: Seeded
}

interface Setup {
  projectId: string
  repo: RegisteredRepository
  full: string
}

let n = 0

describe('GitHub change handler', () => {
  let d: Deployment

  beforeEach(async () => {
    const x = await createTestDatabase()
    const github = fakeGitHub()
    const errors: unknown[] = []
    const mirror = new GitHubPlanningMirror(x.db, github.client, {
      onError: (error) => errors.push(error),
    })
    const handler = new GitHubChangeHandler(x.db, github.client, mirror)
    const services = createServices(x.db, { github: github.reach, planningChanges: mirror })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    const alice = await seedAccount(x.db, { username: 'alice' })
    d = { x, github, mirror, handler, services, errors, alice }
  })

  afterEach(async () => {
    await d?.mirror.idle()
    await d?.x.drop()
  })

  /**
   * `tc-repo` on GitHub with the tool's App installed, registered by alice and added to project
   * Apollo, created by alice.
   */
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

  /** Feeds the handler the change to the issue, and waits for the mirror. */
  async function changed(s: Setup, number: number): Promise<void> {
    const [owner = '', name = ''] = s.full.split('/')
    await d.handler.issueChanged({ owner, name }, number)
    await d.mirror.idle()
  }

  const taskRow = async (id: string) => {
    const [row] = await d.x.db.select().from(tasks).where(eq(tasks.id, id))
    if (!row) throw new Error('No such task')
    return row
  }

  const blockersOf = async (id: string) =>
    (
      await d.x.db
        .select({ blockerId: taskBlockedBy.blockerId })
        .from(taskBlockedBy)
        .where(eq(taskBlockedBy.taskId, id))
    ).map((row) => row.blockerId)

  /** Tasks A (in progress) and B (not started, blocked by A), with issues #1 and #2. */
  async function aBlocksB(s: Setup) {
    const a = await linked(s, 'A')
    const b = await linked(s, 'B')
    await d.services.taskStatus.setStatus(by(d.alice), a.id, 'in-progress')
    await d.services.taskRelations.addBlocker(by(d.alice), b.id, a.id)
    await d.mirror.idle()
    expect([a.issue.number, b.issue.number]).toEqual([1, 2])
    expect(b.issue.blockedBy).toEqual([a.issue.id])
    return { a, b }
  }

  it("TC-137: closing a blocked task's issue on GitHub is reopened (handler, fed the change directly)", async () => {
    const s = await apolloWithRepo()
    const { b } = await aBlocksB(s)

    // Step 1: as tc-writer, close #2 as completed.
    b.issue.state = 'closed'
    b.issue.stateReason = 'completed'
    await changed(s, 2)

    // Step 2: #2 is open; B is not done and has no actual finish.
    expect(d.github.issues.issue(s.full, 2).state).toBe('open')
    const row = await taskRow(b.id)
    expect(row.status).toBe('not-started')
    expect(row.actualFinish).toBeNull()
    expect(d.errors).toEqual([])
  })

  it("TC-138: deleting a blocked task's issue on GitHub is undone by recreating it (handler, fed the change directly)", async () => {
    const s = await apolloWithRepo()
    const { a, b } = await aBlocksB(s)

    // Step 1: as tc-owner, delete #2.
    d.github.issues.deleteIssue(s.full, 2)
    await changed(s, 2)

    // Step 2: a new open issue for B exists in tc-repo, blocked by #1, and is B's linked issue.
    const open = d.github.issues.issuesOf(s.full).filter((issue) => issue.state === 'open')
    const [link] = await d.x.db.select().from(taskIssues).where(eq(taskIssues.taskId, b.id))
    const recreated = open.find((issue) => issue.number === link?.number)
    expect(recreated).toMatchObject({ title: 'B', blockedBy: [a.issue.id] })
    expect(link?.githubId).toBe(recreated?.id)
    expect(link?.number).not.toBe(2)
    // B is not done, has no actual finish and is not cancelled.
    const row = await taskRow(b.id)
    expect(row.status).toBe('not-started')
    expect(row.actualFinish).toBeNull()
    expect(d.errors).toEqual([])
  })

  it("TC-139: closing a parent's issue while a subtask is open is reopened (handler, fed the change directly)", async () => {
    const s = await apolloWithRepo()
    const p = await linked(s, 'P')
    const c = await linked(s, 'C')
    await d.services.taskStatus.setStatus(by(d.alice), p.id, 'in-progress')
    await d.services.taskStatus.setStatus(by(d.alice), c.id, 'in-progress')
    await d.services.taskRelations.setParent(by(d.alice), c.id, p.id)
    await d.mirror.idle()
    expect(c.issue.parent).toBe(p.issue.id)
    const before = await taskRow(c.id)

    // Step 1: as tc-writer, close #1 as completed.
    p.issue.state = 'closed'
    p.issue.stateReason = 'completed'
    await changed(s, 1)

    // Step 2: #1 is open; P is not done and has no actual finish; C is unchanged.
    expect(d.github.issues.issue(s.full, 1).state).toBe('open')
    const row = await taskRow(p.id)
    expect(row.status).toBe('in-progress')
    expect(row.actualFinish).toBeNull()
    expect(await taskRow(c.id)).toEqual(before)
    expect(d.errors).toEqual([])
  })

  it('TC-141: an assignee change made on GitHub is undone (handler, fed the change directly)', async () => {
    await d.services.githubLinks.link(by(d.alice), d.alice.id, 'tc-alice')
    const s = await apolloWithRepo()
    const t = await linked(s, 'T')
    await d.services.tasks.updateTask(by(d.alice), t.id, { assignees: [d.alice.id] })
    await d.mirror.idle()
    expect(t.issue.assignees).toEqual(['tc-alice'])

    // Step 1: as tc-writer, set #1's assignees to [tc-writer].
    t.issue.assignees = ['tc-writer']
    await changed(s, 1)

    // Step 2: #1's assignees are [tc-alice] again; T's assigned people are [alice].
    expect(d.github.issues.issue(s.full, 1).assignees).toEqual(['tc-alice'])
    expect((await d.services.tasks.getTask(by(d.alice), t.id)).assignees).toEqual([d.alice.id])
    expect(d.errors).toEqual([])
  })

  it('TC-142: a sub-issue change made on GitHub is undone (handler, fed the change directly)', async () => {
    const s = await apolloWithRepo()
    const a = await linked(s, 'A')
    const b = await linked(s, 'B')
    const before = [await taskRow(a.id), await taskRow(b.id)]

    // Step 1: as tc-writer, make #2 a sub-issue of #1. The handler is fed the parent's change.
    b.issue.parent = a.issue.id
    await changed(s, 1)

    // Step 2: #1 has no sub-issues; B has no parent in the tool; A's and B's dates are unchanged.
    expect(d.github.issues.subIssues(s.full, 1)).toEqual([])
    expect((await taskRow(b.id)).parentId).toBeNull()
    expect([await taskRow(a.id), await taskRow(b.id)]).toEqual(before)
    expect(d.errors).toEqual([])
  })

  it('TC-143: a blocked-by change made on GitHub is undone (handler, fed the change directly)', async () => {
    const s = await apolloWithRepo()
    const a = await linked(s, 'A')
    const b = await linked(s, 'B')
    await d.services.taskRelations.addBlocker(by(d.alice), b.id, a.id)
    await d.mirror.idle()
    expect(b.issue.blockedBy).toEqual([a.issue.id])
    const before = await taskRow(b.id)

    // Step 1: as tc-writer, remove the blocked-by relation between #2 and #1.
    b.issue.blockedBy = []
    await changed(s, 2)

    // Step 2: #2 is blocked by #1 again; B is still blocked by A; B's dates are unchanged.
    expect(d.github.issues.issue(s.full, 2).blockedBy).toEqual([a.issue.id])
    expect(await blockersOf(b.id)).toEqual([a.id])
    expect(await taskRow(b.id)).toEqual(before)
    expect(d.errors).toEqual([])
  })

  it('restores a sub-issue removed on GitHub when fed the change of the parent', async () => {
    const s = await apolloWithRepo()
    const p = await linked(s, 'P')
    const c = await linked(s, 'C')
    await d.services.taskRelations.setParent(by(d.alice), c.id, p.id)
    await d.mirror.idle()

    c.issue.parent = undefined
    await changed(s, 1)

    expect(d.github.issues.issue(s.full, 2).parent).toBe(p.issue.id)
    expect(d.errors).toEqual([])
  })

  it('restores a blocked-by relation added on GitHub when fed the change of the blocker', async () => {
    const s = await apolloWithRepo()
    const a = await linked(s, 'A')
    const b = await linked(s, 'B')

    b.issue.blockedBy = [a.issue.id]
    await changed(s, 1)

    expect(d.github.issues.issue(s.full, 2).blockedBy).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('does not reopen a closed issue whose task may be finished', async () => {
    const s = await apolloWithRepo()
    const t = await linked(s, 'T')
    await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')

    t.issue.state = 'closed'
    t.issue.stateReason = 'completed'
    await changed(s, 1)

    expect(d.github.issues.issue(s.full, 1).state).toBe('closed')
    expect(d.errors).toEqual([])
  })

  it('does not reopen a blocked task closed as not planned, which cancels rather than finishes it', async () => {
    const s = await apolloWithRepo()
    const { b } = await aBlocksB(s)

    b.issue.state = 'closed'
    b.issue.stateReason = 'not_planned'
    await changed(s, 2)

    expect(d.github.issues.issue(s.full, 2)).toMatchObject({
      state: 'closed',
      stateReason: 'not_planned',
    })
    expect(d.errors).toEqual([])
  })

  it('creates a deleted issue again once only when fed the change twice', async () => {
    const s = await apolloWithRepo()
    await aBlocksB(s)

    d.github.issues.deleteIssue(s.full, 2)
    const [owner = '', name = ''] = s.full.split('/')
    await Promise.all([
      d.handler.issueChanged({ owner, name }, 2),
      d.handler.issueChanged({ owner, name }, 2),
    ])
    await d.mirror.idle()

    expect(d.github.issues.issuesOf(s.full).map((issue) => issue.number)).toEqual([1, 3])
    expect(d.errors).toEqual([])
  })

  it('keeps the issue subscriptions of a task whose deleted issue it creates again', async () => {
    const s = await apolloWithRepo()
    const { b } = await aBlocksB(s)
    await d.services.notifications.subscribeToIssue(by(d.alice), b.id)

    d.github.issues.deleteIssue(s.full, 2)
    await changed(s, 2)

    const { issues } = await d.services.notifications.subscriptionsOf(by(d.alice))
    expect(issues).toEqual([expect.objectContaining({ taskId: b.id, number: 3 })])
    expect(d.errors).toEqual([])
  })

  it('ignores the issue of a task its project kept after a withdrawal (FR-182)', async () => {
    const s = await apolloWithRepo()
    const { b } = await aBlocksB(s)
    const [request] = await d.services.projectRepositories.listProjectRequests(
      by(d.alice),
      s.projectId,
    )
    await d.services.projectRepositories.withdrawApproval(by(d.alice), request?.id ?? '')
    d.github.requests.length = 0

    b.issue.state = 'closed'
    b.issue.stateReason = 'completed'
    await changed(s, 2)

    expect(d.github.issues.issue(s.full, 2).state).toBe('closed')
    expect(d.github.requests).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('ignores an issue linked to no task', async () => {
    const s = await apolloWithRepo()
    d.github.issues.createIssue(s.full, 'Not a task')
    d.github.requests.length = 0

    await changed(s, 1)

    expect(d.github.requests).toEqual([])
    expect(d.errors).toEqual([])
  })
})
