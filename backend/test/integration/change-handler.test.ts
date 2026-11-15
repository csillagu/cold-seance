import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, taskBlockedBy, taskIssues, tasks } from '../../src/db/schema.ts'
import { GitHubChangeHandler } from '../../src/github/change-handler.ts'
import { GitHubPlanningMirror } from '../../src/github/planning-mirror.ts'
import type { AuditEntry } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { localToday } from '../../src/service/task-status.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import type { FakeIssue } from '../helpers/github-issues.ts'
import { grantRole } from '../helpers/projects.ts'

// The GitHub change handler (SC-023) against a real PostgreSQL and a fake GitHub. The test cases'
// "as tc-writer, ..." steps are made on the fake GitHub directly, and the handler is then fed the
// change, as the webhook endpoint and the re-check (SC-105, SC-024: B17) will feed it; the tests
// wait for the planning mirror (SC-022) to be idle, well within the hour the test cases allow.
// Each task gets its issue as the test cases' "so it has issue #1" describes: it is assigned to
// the repository, and the GitHub issue creator (SC-060) opens it. The test cases' "GitHub Project
// with a status field that the tool uses" is a fake Project whose field is `Status`, with the
// options `In Progress` and `On Hold`: the configuration's defaults (SRC-252).
//
// The step of each test case that waits "within an hour" for a change made on GitHub to reach the
// tool, through a webhook or the re-check (SC-105, SC-024), is in github-sync.test.ts.
//
// Pending: the revert comments (SC-062: B18).

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
  bob: Seeded
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
    const services = createServices(x.db, { github: github.reach, planningChanges: mirror })
    const handler = new GitHubChangeHandler(x.db, github.client, mirror, services)
    const app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    const alice = await seedAccount(x.db, { username: 'alice' })
    const bob = await seedAccount(x.db, { username: 'bob' })
    d = { x, github, mirror, handler, services, app, errors, alice, bob }
  })

  afterEach(async () => {
    await d?.mirror.idle()
    await d?.app.close()
    await d?.x.drop()
  })

  /** `tc-repo` on GitHub with the tool's App installed, registered by alice. */
  async function tcRepo(): Promise<{ repo: RegisteredRepository; full: string }> {
    const full = `csillagu/tc-repo-${++n}`
    const [owner = '', name = ''] = full.split('/')
    d.github.createRepository(full)
    const repo = await d.services.repositories.registerRepository(by(d.alice), { owner, name })
    return { repo, full }
  }

  /** A project created by `creator` that pulls issues from the repository. */
  async function pulling(creator: Seeded, name: string, repo: RegisteredRepository) {
    const project = await d.services.projects.createProject(by(creator), { name: `${name} ${n}` })
    const [request] = [
      await d.services.projectRepositories.requestRepository(by(creator), project.id, repo.id),
    ]
    if (request?.state !== 'approved') {
      await d.services.projectRepositories.approveRequest(by(d.alice), request?.id ?? '')
    }
    return project.id
  }

  /** tc-repo, added to project Apollo, created by alice. */
  async function apolloWithRepo(): Promise<Setup> {
    const { repo, full } = await tcRepo()
    return { projectId: await pulling(d.alice, 'Apollo', repo), repo, full }
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

  const repositoryOf = (s: { full: string }) => {
    const [owner = '', name = ''] = s.full.split('/')
    return { owner, name }
  }

  /** Feeds the handler the change `sender` made to the issue, and waits for the mirror. */
  async function changed(s: Setup, number: number, sender = 'tc-writer'): Promise<void> {
    await d.handler.issueChanged(repositoryOf(s), number, sender)
    await d.mirror.idle()
  }

  /** Feeds the handler the issue `sender` opened, and waits for the mirror. */
  async function opened(s: { full: string }, number: number, sender = 'tc-writer') {
    await d.handler.issueOpened(repositoryOf(s), number, sender)
    await d.mirror.idle()
  }

  const close = (issue: FakeIssue, reason = 'completed') => {
    issue.state = 'closed'
    issue.stateReason = reason
  }

  const taskRow = async (id: string) => {
    const [row] = await d.x.db.select().from(tasks).where(eq(tasks.id, id))
    if (!row) throw new Error('No such task')
    return row
  }

  /** Reads the task through the REST API, as alice. */
  const readTask = async (id: string) => {
    const response = await d.app.inject({
      method: 'GET',
      url: `/api/tasks/${id}`,
      headers: as(d.alice),
    })
    expect(response.statusCode).toBe(200)
    return response.json<Record<string, unknown>>()
  }

  const tasksOf = async (projectId: string) =>
    d.x.db.select().from(tasks).where(eq(tasks.projectId, projectId))

  const blockersOf = async (id: string) =>
    (
      await d.x.db
        .select({ blockerId: taskBlockedBy.blockerId })
        .from(taskBlockedBy)
        .where(eq(taskBlockedBy.taskId, id))
    ).map((row) => row.blockerId)

  /** Entries recorded under a GitHub login. */
  const githubEntries = async () =>
    (await d.x.db.select().from(auditLog)).filter((entry) => entry.actorGithubLogin !== null)

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

  const today = localToday()

  describe('status changes made on GitHub', () => {
    it('TC-131: starting an issue on GitHub starts its task (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      const item = d.github.issues.addToProject(s.full, 1)

      // Step 1: as tc-writer, set #1's status field to the value for started.
      item.status = 'In Progress'
      await changed(s, 1)

      // Step 2: T is in progress, with actual start D; no revert is made on #1.
      expect(await readTask(t.id)).toMatchObject({ status: 'in-progress', actualStart: today })
      expect(item.status).toBe('In Progress')
      expect(d.errors).toEqual([])
    })

    it('TC-132: putting an issue on hold on GitHub puts its task on hold (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.tasks.updateTask(by(d.alice), t.id, {
        plannedStart: '2027-03-01',
        plannedFinish: '2027-03-05',
      })
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      const item = d.github.issues.addToProject(s.full, 1)

      // Step 1: as tc-writer, set #1's status field to the value for on hold.
      item.status = 'On Hold'
      await changed(s, 1)

      // Step 2: T is on hold; its planned finish is still 2027-03-05.
      expect(await readTask(t.id)).toMatchObject({
        status: 'on-hold',
        plannedFinish: '2027-03-05',
      })
      expect(d.errors).toEqual([])
    })

    it('TC-133: closing an issue on GitHub finishes its task (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')

      // Step 1: as tc-writer, close #1 as completed.
      close(t.issue)
      await changed(s, 1)

      // Step 2: T is done, with actual finish D; #1 is not reopened.
      expect(await readTask(t.id)).toMatchObject({ status: 'done', actualFinish: today })
      expect(d.github.issues.issue(s.full, 1).state).toBe('closed')
      expect(d.errors).toEqual([])
    })

    it('TC-134: a merged pull request that closes an issue finishes its task (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')

      // Step 1: tc-writer merges a pull request whose description says "Closes #1", so GitHub
      // closes #1 as completed, in tc-writer's name.
      close(t.issue)
      await changed(s, 1)

      // Step 2: T is done, with actual finish D; #1 is not reopened.
      expect(await readTask(t.id)).toMatchObject({ status: 'done', actualFinish: today })
      expect(d.github.issues.issue(s.full, 1).state).toBe('closed')
      expect(d.errors).toEqual([])
    })

    it('TC-135: reopening a finished issue sets its task back to in progress (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      close(t.issue)
      await changed(s, 1)
      const finished = await readTask(t.id)
      expect(finished).toMatchObject({ status: 'done', actualFinish: today })

      // Step 1: as tc-writer, reopen #1.
      t.issue.state = 'open'
      t.issue.stateReason = null
      await changed(s, 1)

      // Step 2: T is in progress with no actual finish; its actual start is unchanged; #1 is not
      // closed again.
      expect(await readTask(t.id)).toMatchObject({
        status: 'in-progress',
        actualFinish: null,
        actualStart: finished['actualStart'],
      })
      expect(d.github.issues.issue(s.full, 1).state).toBe('open')
      expect(d.errors).toEqual([])
    })

    it('TC-140: closing an issue as not planned cancels its task (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')

      // Step 1: as tc-writer, close #1 as not planned.
      close(t.issue, 'not_planned')
      await changed(s, 1)

      // Step 2: T is cancelled, not done, with no actual finish; #1 is not reopened.
      expect(await readTask(t.id)).toMatchObject({ status: 'cancelled', actualFinish: null })
      expect(d.github.issues.issue(s.full, 1)).toMatchObject({
        state: 'closed',
        stateReason: 'not_planned',
      })
      expect(d.errors).toEqual([])
    })

    it('TC-145: a status change on GitHub by someone with no tool account is accepted (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')

      // Step 1: as tc-writer, linked to no account in the tool, close #1 as completed.
      close(t.issue)
      await changed(s, 1, 'tc-writer')

      // Step 2: T is done; #1 is not reopened.
      expect(await readTask(t.id)).toMatchObject({ status: 'done' })
      expect(d.github.issues.issue(s.full, 1).state).toBe('closed')
      expect(d.errors).toEqual([])
    })

    it('TC-146: a status change on GitHub by a read-only member is accepted (handler, fed the change directly)', async () => {
      await d.services.githubLinks.link(by(d.bob), d.bob.id, 'tc-bob')
      const s = await apolloWithRepo()
      await grantRole(d.x.db, d.bob, s.projectId, 'read-only')
      const t = await linked(s, 'T')
      const item = d.github.issues.addToProject(s.full, 1)

      // Step 1: as tc-bob, set #1's status field to the value for started.
      item.status = 'In Progress'
      await changed(s, 1, 'tc-bob')

      // Step 2: T is in progress; #1's status field is not reset.
      expect(await readTask(t.id)).toMatchObject({ status: 'in-progress' })
      expect(item.status).toBe('In Progress')
      expect(d.errors).toEqual([])
    })

    it('TC-201: a linked issue deleted on GitHub finishes its task as a close would (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')

      // Step 1: as tc-owner, delete #1.
      d.github.issues.deleteIssue(s.full, 1)
      await changed(s, 1, 'tc-owner')

      // Step 2: T is done, with actual finish D; it is not cancelled; no new issue is created.
      expect(await readTask(t.id)).toMatchObject({ status: 'done', actualFinish: today })
      expect(d.github.issues.issuesOf(s.full)).toEqual([])
      // Nothing is mirrored to an issue that is gone, then or at the re-check.
      await d.mirror.mirrorAll()
      expect(d.errors).toEqual([])
    })

    it('TC-173: a change arriving from GitHub is logged with the GitHub channel', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      const before = new Date()

      // Step 1: as tc-writer, close #1 at time t.
      close(t.issue)
      await changed(s, 1, 'tc-writer')

      // Step 2: after T is done, read the audit log of Apollo as alice.
      expect(await readTask(t.id)).toMatchObject({ status: 'done' })
      const response = await d.app.inject({
        method: 'GET',
        url: `/api/audit-log?projectId=${s.projectId}`,
        headers: as(d.alice),
      })
      expect(response.statusCode).toBe(200)
      const entries = response.json<(Omit<AuditEntry, 'at'> & { at: string })[]>()
      const finished = entries.filter(
        (e) =>
          e.action === 'task.status-set' &&
          e.subject.id === t.id &&
          Reflect.get(Object(e.details['changes']), 'status') === 'done',
      )
      // An entry records T being finished, through GitHub, no earlier than t, naming tc-writer;
      // not through the UI, the REST API or the MCP server.
      expect(finished).toEqual([
        expect.objectContaining({ channels: ['github'], by: { githubLogin: 'tc-writer' } }),
      ])
      expect(new Date(finished[0]?.at ?? 0).getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      )
      expect(d.errors).toEqual([])
    })
  })

  describe('status changes that break a constraint are reverted', () => {
    it("TC-136: starting a blocked task's issue on GitHub is reset (handler, fed the change directly)", async () => {
      const s = await apolloWithRepo()
      const { b } = await aBlocksB(s)
      const item = d.github.issues.addToProject(s.full, 2, { status: 'Todo' })
      await changed(s, 2)

      // Step 1: as tc-writer, set #2's status field to the value for started.
      item.status = 'In Progress'
      await changed(s, 2)

      // Step 2: #2's status field is back to its value from before step 1; B is not started and
      // has no actual start.
      expect(item.status).toBe('Todo')
      expect(await readTask(b.id)).toMatchObject({ status: 'not-started', actualStart: null })
      expect(await githubEntries()).toEqual([])
      expect(d.errors).toEqual([])
    })

    it("TC-137: closing a blocked task's issue on GitHub is reopened (handler, fed the change directly)", async () => {
      const s = await apolloWithRepo()
      const { b } = await aBlocksB(s)

      // Step 1: as tc-writer, close #2 as completed.
      close(b.issue)
      await changed(s, 2)

      // Step 2: #2 is open; B is not done and has no actual finish.
      expect(d.github.issues.issue(s.full, 2).state).toBe('open')
      expect(await readTask(b.id)).toMatchObject({ status: 'not-started', actualFinish: null })
      expect(d.errors).toEqual([])
    })

    it("TC-138: deleting a blocked task's issue on GitHub is undone by recreating it (handler, fed the change directly)", async () => {
      const s = await apolloWithRepo()
      const { a, b } = await aBlocksB(s)

      // Step 1: as tc-owner, delete #2.
      d.github.issues.deleteIssue(s.full, 2)
      await changed(s, 2, 'tc-owner')

      // Step 2: a new open issue for B exists in tc-repo, blocked by #1, and is B's linked issue.
      const open = d.github.issues.issuesOf(s.full).filter((issue) => issue.state === 'open')
      const [link] = await d.x.db.select().from(taskIssues).where(eq(taskIssues.taskId, b.id))
      const recreated = open.find((issue) => issue.number === link?.number)
      expect(recreated).toMatchObject({ title: 'B', blockedBy: [a.issue.id] })
      expect(link?.githubId).toBe(recreated?.id)
      expect(link?.number).not.toBe(2)
      // B is not done, has no actual finish and is not cancelled.
      expect(await readTask(b.id)).toMatchObject({ status: 'not-started', actualFinish: null })
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
      close(p.issue)
      await changed(s, 1)

      // Step 2: #1 is open; P is not done and has no actual finish; C is unchanged.
      expect(d.github.issues.issue(s.full, 1).state).toBe('open')
      expect(await readTask(p.id)).toMatchObject({ status: 'in-progress', actualFinish: null })
      expect(await taskRow(c.id)).toEqual(before)
      expect(d.errors).toEqual([])
    })

    it('clears a start on a blocked task whose issue had no status before', async () => {
      const s = await apolloWithRepo()
      const { b } = await aBlocksB(s)
      const item = d.github.issues.addToProject(s.full, 2)

      item.status = 'In Progress'
      await changed(s, 2)

      expect(item.status).toBeNull()
      expect((await taskRow(b.id)).status).toBe('not-started')
      expect(d.errors).toEqual([])
    })

    it('reopens the issue of a milestone another project depends on, closed as not planned', async () => {
      const { repo, full } = await tcRepo()
      const apollo = await pulling(d.alice, 'Apollo', repo)
      const borealis = await d.services.projects.createProject(by(d.alice), { name: 'Borealis' })
      const s = { projectId: apollo, repo, full }
      const m = await d.services.tasks.createTask(by(d.alice), apollo, {
        title: 'M',
        milestone: { variant: 'floating' },
      })
      await d.services.taskRepository.assignRepository(by(d.alice), m.id, repo.id)
      const other = await d.services.tasks.createTask(by(d.alice), borealis.id, { title: 'X' })
      await d.services.taskRelations.addBlocker(by(d.alice), other.id, m.id)
      await d.mirror.idle()

      close(d.github.issues.issue(full, 1), 'not_planned')
      await changed(s, 1)

      expect(d.github.issues.issue(full, 1).state).toBe('open')
      expect((await taskRow(m.id)).status).toBe('not-started')
      expect(d.errors).toEqual([])
    })
  })

  describe('planning edits made on GitHub are undone', () => {
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
      expect(await readTask(t.id)).toMatchObject({ assignees: [d.alice.id] })
      expect(await githubEntries()).toEqual([])
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
      await linked(s, 'B')
      d.github.issues.issue(s.full, 2).blockedBy = [a.issue.id]
      await changed(s, 1)

      expect(d.github.issues.issue(s.full, 2).blockedBy).toEqual([])
      expect(d.errors).toEqual([])
    })
  })

  describe('new issues opened on GitHub', () => {
    it('TC-147: a new issue opened on GitHub becomes an unscheduled task (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()

      // Step 1: as tc-writer, with no account in the tool, open issue "Crash on start".
      const issue = d.github.issues.createIssue(s.full, 'Crash on start')
      await opened(s, issue.number)

      // Step 2: Apollo has a task linked to it, with no planned dates or assigned people.
      const list = await d.app.inject({
        method: 'GET',
        url: `/api/projects/${s.projectId}/tasks`,
        headers: as(d.alice),
      })
      expect(list.statusCode).toBe(200)
      const found = list.json<Record<string, unknown>[]>()
      expect(found).toEqual([
        expect.objectContaining({
          title: 'Crash on start',
          status: 'not-started',
          plannedStart: null,
          plannedFinish: null,
          assignees: [],
        }),
      ])
      const [link] = await d.x.db.select().from(taskIssues)
      expect(link).toMatchObject({ taskId: found[0]?.['id'], number: issue.number })
      // The creation is logged under tc-writer's login, through GitHub.
      expect(await githubEntries()).toEqual([
        expect.objectContaining({
          action: 'task.created',
          actorGithubLogin: 'tc-writer',
          actorAccountId: null,
          channels: ['github'],
        }),
      ])
      expect(d.errors).toEqual([])
    })

    it('TC-228: an issue opened on GitHub with dates becomes an unscheduled task (handler, fed the change directly)', async () => {
      const s = await apolloWithRepo()

      // Step 1: as tc-writer, open issue "Dated" and fill its Project date fields with
      // 2027-03-01 to 2027-03-05. The tool reads no date field of a Project.
      const issue = d.github.issues.createIssue(s.full, 'Dated')
      d.github.issues.addToProject(s.full, issue.number)
      await opened(s, issue.number)

      // Step 2: the task for "Dated" has no planned start and no planned finish.
      expect(await tasksOf(s.projectId)).toEqual([
        expect.objectContaining({ title: 'Dated', plannedStart: null, plannedFinish: null }),
      ])
      expect(d.errors).toEqual([])
    })

    it("TC-229: a shared repository's new issue goes only to its receiving project (handler, fed the change directly)", async () => {
      const { repo, full } = await tcRepo()
      const apollo = await pulling(d.alice, 'Apollo', repo)
      const borealis = await pulling(d.bob, 'Borealis', repo)
      await d.services.receivingProjects.markReceiving(by(d.alice), apollo, repo.id)

      // Step 1: as tc-writer, open issue "Shared bug".
      const issue = d.github.issues.createIssue(full, 'Shared bug')
      await opened({ full }, issue.number)

      // Step 2: Apollo has an unscheduled task for it; Borealis has none.
      expect(await tasksOf(apollo)).toEqual([
        expect.objectContaining({ title: 'Shared bug', plannedStart: null }),
      ])
      expect(await tasksOf(borealis)).toEqual([])
      expect(d.errors).toEqual([])
    })

    it('TC-212: a receiving project that stops pulling stops receiving new issues (steps 2 and 3)', async () => {
      const s = await apolloWithRepo()
      await d.services.receivingProjects.markReceiving(by(d.alice), s.projectId, s.repo.id)
      const kept = await linked(s, 'Kept')
      // Step 1: as alice, remove tc-repo from the repositories Apollo pulls issues from.
      await d.services.projectRepositories.removeRepository(by(d.alice), s.projectId, s.repo.id)

      // Step 2: as tc-writer, open issue "After removal".
      const issue = d.github.issues.createIssue(s.full, 'After removal')
      await opened(s, issue.number)

      // Step 3: Apollo has no task for it; the task it already had from tc-repo remains.
      expect((await tasksOf(s.projectId)).map((t) => t.id)).toEqual([kept.id])
      expect(d.errors).toEqual([])
    })

    it('adds a new issue to no project while several pull from the repository and none receives', async () => {
      const { repo, full } = await tcRepo()
      const apollo = await pulling(d.alice, 'Apollo', repo)
      const borealis = await pulling(d.bob, 'Borealis', repo)

      const issue = d.github.issues.createIssue(full, 'Nobody receives')
      await opened({ full }, issue.number)

      expect([...(await tasksOf(apollo)), ...(await tasksOf(borealis))]).toEqual([])
    })

    it('does not take an issue the tool opened for a task for a new one', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')

      await opened(s, t.issue.number)

      expect((await tasksOf(s.projectId)).map((row) => row.id)).toEqual([t.id])
    })

    it('makes one task of an issue it is told of twice', async () => {
      const s = await apolloWithRepo()
      const issue = d.github.issues.createIssue(s.full, 'Twice')
      await Promise.all([
        d.handler.issueOpened(repositoryOf(s), issue.number, 'tc-writer'),
        d.handler.issueOpened(repositoryOf(s), issue.number, 'tc-writer'),
      ])
      await d.mirror.idle()

      expect(await tasksOf(s.projectId)).toHaveLength(1)
    })
  })

  describe('edges', () => {
    it('takes a change it is told of twice in once', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      close(t.issue)
      await changed(s, 1)
      await changed(s, 1)

      const finishes = (await githubEntries()).filter((e) => e.action === 'task.status-set')
      expect(finishes).toHaveLength(1)
    })

    it('does not set back from GitHub a status set in the tool since', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      const item = d.github.issues.addToProject(s.full, 1)
      item.status = 'On Hold'
      await changed(s, 1)
      expect((await taskRow(t.id)).status).toBe('on-hold')

      // Set in progress in the tool; GitHub still shows on hold, which has not changed there.
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      await changed(s, 1)
      expect((await taskRow(t.id)).status).toBe('in-progress')
    })

    it('takes no option from an issue whose Projects disagree', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      d.github.issues.addToProject(s.full, 1, { status: 'In Progress' })
      d.github.issues.addToProject(s.full, 1, { status: 'On Hold' })

      await changed(s, 1)

      expect((await taskRow(t.id)).status).toBe('not-started')
    })

    it('reads the status field and options the configuration names (SRC-252)', async () => {
      const handler = new GitHubChangeHandler(d.x.db, d.github.client, d.mirror, d.services, {
        statusField: { name: 'Status', started: 'Todo', onHold: 'Done' },
      })
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      const item = d.github.issues.addToProject(s.full, 1)

      item.status = 'Todo'
      await handler.issueChanged(repositoryOf(s), 1, 'tc-writer')
      expect((await taskRow(t.id)).status).toBe('in-progress')
      item.status = 'In Progress'
      await handler.issueChanged(repositoryOf(s), 1, 'tc-writer')
      expect((await taskRow(t.id)).status).toBe('in-progress')
      item.status = 'Done'
      await handler.issueChanged(repositoryOf(s), 1, 'tc-writer')
      expect((await taskRow(t.id)).status).toBe('on-hold')
      await d.mirror.idle()
    })

    it('does not reopen a blocked task closed as not planned, which cancels it', async () => {
      const s = await apolloWithRepo()
      const { b } = await aBlocksB(s)

      close(b.issue, 'not_planned')
      await changed(s, 2)

      expect(d.github.issues.issue(s.full, 2).state).toBe('closed')
      expect((await taskRow(b.id)).status).toBe('cancelled')
      expect(d.errors).toEqual([])
    })

    it('creates a deleted issue again once only when fed the change twice', async () => {
      const s = await apolloWithRepo()
      await aBlocksB(s)

      d.github.issues.deleteIssue(s.full, 2)
      await Promise.all([
        d.handler.issueChanged(repositoryOf(s), 2, 'tc-owner'),
        d.handler.issueChanged(repositoryOf(s), 2, 'tc-owner'),
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
      await changed(s, 2, 'tc-owner')

      const { issues } = await d.services.notifications.subscriptionsOf(by(d.alice))
      expect(issues).toEqual([expect.objectContaining({ taskId: b.id, number: 3 })])
      expect(d.errors).toEqual([])
    })

    it('ignores the issue of a task its project kept after a withdrawal (FR-182)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      const [request] = await d.services.projectRepositories.listProjectRequests(
        by(d.alice),
        s.projectId,
      )
      await d.services.projectRepositories.withdrawApproval(by(d.alice), request?.id ?? '')
      d.github.requests.length = 0

      close(t.issue)
      await changed(s, 1)

      expect((await taskRow(t.id)).status).toBe('in-progress')
      expect(d.github.requests).toEqual([])
      expect(d.errors).toEqual([])
    })

    it('ignores a change to an issue linked to no task', async () => {
      const s = await apolloWithRepo()
      d.github.issues.createIssue(s.full, 'Not a task')
      d.github.requests.length = 0

      await changed(s, 1)

      expect(d.github.requests).toEqual([])
      expect(d.errors).toEqual([])
    })
  })
})
