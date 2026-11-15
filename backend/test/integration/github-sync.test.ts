import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { GitHubAppConfig } from '../../src/config/config.ts'
import { auditLog, recheckRuns, taskBlockedBy, taskIssues, tasks } from '../../src/db/schema.ts'
import { GitHubChangeHandler, RECHECK_ACTOR } from '../../src/github/change-handler.ts'
import { GitHubPlanningMirror } from '../../src/github/planning-mirror.ts'
import { recheckLinkedIssues } from '../../src/github/recheck.ts'
import { RecheckTimer } from '../../src/github/recheck-timer.ts'
import { GitHubWebhookReceiver } from '../../src/github/webhooks.ts'
import type { Caller } from '../../src/service/caller.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { localToday } from '../../src/service/task-status.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import type { FakeIssue } from '../helpers/github-issues.ts'

// How changes made on GitHub reach the tool (SC-105, SC-024): by a signed webhook delivery to the
// webhook endpoint, or found by the re-check timer, against a real PostgreSQL and a fake GitHub.
// This is the "within an hour" step of the GitHub change handler's test cases (SC-023, B16):
// what the handler does with a change is tested in change-handler.test.ts, fed the change
// directly; here each kind of change arrives the way it arrives from GitHub. The test cases'
// "as tc-writer, ..." steps are made on the fake GitHub directly. The re-check's clock is the
// test's, so that "60 minutes after" needs no waiting.
//
// The revert comments and the notifications of reverts (SC-062) are in revert-commenter.test.ts.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

/** The webhook secret of the tool's GitHub App in these tests, and of repository webhooks. */
const APP_SECRET = 'tc-app-webhook-secret'
const REPOSITORY_SECRET = 'tc-repository-webhook-secret'
const APP_ID = 260

const app: GitHubAppConfig = {
  appId: APP_ID,
  privateKeyFile: '/run/secrets/tc-app.pem',
  privateKey: 'unused',
  webhookSecret: APP_SECRET,
}

interface Deployment {
  x: TestDatabase
  github: FakeGitHub
  mirror: GitHubPlanningMirror
  handler: GitHubChangeHandler
  receiver: GitHubWebhookReceiver
  services: Services
  web: ReturnType<typeof buildApp>
  errors: unknown[]
  /** The re-check's clock. */
  clock: { now: Date }
  timer: RecheckTimer
  alice: Seeded
}

interface Setup {
  projectId: string
  repo: RegisteredRepository
  full: string
  owner: string
  name: string
}

let n = 0

describe('GitHub changes reaching the tool', () => {
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
    const receiver = new GitHubWebhookReceiver(
      x.db,
      { apps: { readIssues: app, writeIssues: app }, webhookSecret: REPOSITORY_SECRET },
      handler,
      github.client,
      { onError: (error) => errors.push(error) },
    )
    const web = buildApp({}, { authenticators: [testAuthenticator], services, webhooks: receiver })
    const clock = { now: new Date('2026-11-16T09:00:00Z') }
    const timer = new RecheckTimer(
      x.db,
      recheckLinkedIssues(x.db, { handler, mirror }, { onError: (error) => errors.push(error) }),
      { intervalMinutes: 60, now: () => clock.now, onError: (error) => errors.push(error) },
    )
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    const alice = await seedAccount(x.db, { username: 'alice' })
    d = { x, github, mirror, handler, receiver, services, web, errors, clock, timer, alice }
  })

  afterEach(async () => {
    await d?.timer.stop()
    await d?.receiver.idle()
    await d?.mirror.idle()
    await d?.web.close()
    await d?.x.drop()
  })

  /** tc-repo with the tool's App installed, registered by alice and added to project Apollo. */
  async function apolloWithRepo(repoName = 'tc-repo'): Promise<Setup> {
    const full = `csillagu/${repoName}-${++n}`
    const [owner = '', name = ''] = full.split('/')
    d.github.createRepository(full)
    const repo = await d.services.repositories.registerRepository(by(d.alice), { owner, name })
    const project = await d.services.projects.createProject(by(d.alice), { name: `Apollo ${n}` })
    const request = await d.services.projectRepositories.requestRepository(
      by(d.alice),
      project.id,
      repo.id,
    )
    expect(request.state).toBe('approved')
    return { projectId: project.id, repo, full, owner, name }
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

  /** Reads the task through the REST API, as alice. */
  const readTask = async (id: string) => {
    const response = await d.web.inject({
      method: 'GET',
      url: `/api/tasks/${id}`,
      headers: as(d.alice),
    })
    expect(response.statusCode).toBe(200)
    return response.json<Record<string, unknown>>()
  }

  const close = (issue: FakeIssue, reason = 'completed', closer = 'tc-writer') => {
    issue.state = 'closed'
    issue.stateReason = reason
    issue.closedBy = closer
  }

  /** The issue as a delivery names it. */
  const issueJson = (s: Setup, issue: FakeIssue) => ({
    id: issue.id,
    number: issue.number,
    title: issue.title,
    repository_url: `https://api.github.com/repos/${s.owner}/${s.name}`,
  })

  /** A delivery as GitHub sends it, signed with `secret`, from the App unless told otherwise. */
  async function deliver(
    event: string,
    payload: Record<string, unknown>,
    options: { secret?: string | null; from?: 'integration' | 'repository' } = {},
  ) {
    const body = JSON.stringify({ sender: { login: 'tc-writer' }, ...payload })
    const secret = options.secret === undefined ? APP_SECRET : options.secret
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-hook-installation-target-type': options.from ?? 'integration',
      'x-github-hook-installation-target-id': String(APP_ID),
    }
    if (secret !== null) {
      headers['x-hub-signature-256'] =
        `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
    }
    // Sent with no authentication: GitHub does not sign in.
    const response = await d.web.inject({
      method: 'POST',
      url: '/api/github/webhooks',
      headers,
      body,
    })
    await d.receiver.idle()
    await d.mirror.idle()
    return response
  }

  const githubEntries = async () =>
    (await d.x.db.select().from(auditLog)).filter((entry) => entry.actorGithubLogin !== null)

  const today = localToday()

  describe('by webhook (SC-105)', () => {
    it('TC-131: starting an issue on GitHub starts its task (end to end: webhook)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      const item = d.github.issues.addToProject(s.full, 1)

      // Step 1: as tc-writer, set #1's status field to the value for started. GitHub tells the
      // App of the change to the Project item, naming the issue by its node id.
      item.status = 'In Progress'
      const response = await deliver('projects_v2_item', {
        action: 'edited',
        projects_v2_item: { content_node_id: t.issue.nodeId, content_type: 'Issue' },
        organization: { login: s.owner },
      })
      expect(response.statusCode).toBe(202)

      // Step 2: within an hour (at once), T is in progress with actual start D, read through
      // the REST API. No revert is made on #1.
      expect(await readTask(t.id)).toMatchObject({ status: 'in-progress', actualStart: today })
      expect(item.status).toBe('In Progress')
      expect((await githubEntries()).map((e) => e.actorGithubLogin)).toEqual(['tc-writer'])
      expect(d.errors).toEqual([])
    })

    it('TC-133: closing an issue on GitHub finishes its task (end to end: webhook)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')

      // Step 1: as tc-writer, close #1 as completed.
      close(t.issue)
      await deliver('issues', { action: 'closed', issue: issueJson(s, t.issue) })

      // Step 2: T is done, with actual finish D; #1 is not reopened.
      expect(await readTask(t.id)).toMatchObject({ status: 'done', actualFinish: today })
      expect(d.github.issues.issue(s.full, 1).state).toBe('closed')
      expect(d.errors).toEqual([])
    })

    it('TC-140: closing an issue as not planned cancels its task (end to end: repository webhook)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')

      // Step 1: as tc-writer, close #1 as not planned; the repository's own webhook tells the tool.
      close(t.issue, 'not_planned')
      const response = await deliver(
        'issues',
        { action: 'closed', issue: issueJson(s, t.issue) },
        { secret: REPOSITORY_SECRET, from: 'repository' },
      )
      expect(response.statusCode).toBe(202)

      // Step 2: T is cancelled.
      expect(await readTask(t.id)).toMatchObject({ status: 'cancelled' })
      expect(d.errors).toEqual([])
    })

    it('TC-201: a linked issue deleted on GitHub finishes its task (end to end: webhook)', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')

      // Step 1: delete #1 on GitHub.
      const named = issueJson(s, t.issue)
      d.github.issues.deleteIssue(s.full, 1)
      await deliver('issues', { action: 'deleted', issue: named })

      // Step 2: T is done, with actual finish D.
      expect(await readTask(t.id)).toMatchObject({ status: 'done', actualFinish: today })
      expect(d.errors).toEqual([])
    })

    it('TC-141: an assignee change made on GitHub is undone (end to end: webhook)', async () => {
      await d.services.githubLinks.link(by(d.alice), d.alice.id, 'tc-alice')
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.tasks.updateTask(by(d.alice), t.id, { assignees: [d.alice.id] })
      await d.mirror.idle()

      // Step 1: as tc-writer, set #1's assignees to [tc-writer].
      t.issue.assignees = ['tc-writer']
      await deliver('issues', { action: 'assigned', issue: issueJson(s, t.issue) })

      // Step 2: #1's assignees are [tc-alice] again; T's assigned people are [alice].
      expect(d.github.issues.issue(s.full, 1).assignees).toEqual(['tc-alice'])
      expect(await readTask(t.id)).toMatchObject({ assignees: [d.alice.id] })
      expect(d.errors).toEqual([])
    })

    it('TC-142: a sub-issue change made on GitHub is undone (end to end: webhook)', async () => {
      const s = await apolloWithRepo()
      const a = await linked(s, 'A')
      const b = await linked(s, 'B')

      // Step 1: as tc-writer, make #2 a sub-issue of #1.
      b.issue.parent = a.issue.id
      await deliver('sub_issues', {
        action: 'sub_issue_added',
        parent_issue: issueJson(s, a.issue),
        sub_issue: issueJson(s, b.issue),
      })

      // Step 2: #1 has no sub-issues; B has no parent in the tool.
      expect(d.github.issues.subIssues(s.full, 1)).toEqual([])
      const [row] = await d.x.db.select().from(tasks).where(eq(tasks.id, b.id))
      expect(row?.parentId).toBeNull()
      expect(d.errors).toEqual([])
    })

    it('TC-143: a blocked-by change made on GitHub is undone (end to end: webhook)', async () => {
      const s = await apolloWithRepo()
      const a = await linked(s, 'A')
      const b = await linked(s, 'B')
      await d.services.taskRelations.addBlocker(by(d.alice), b.id, a.id)
      await d.mirror.idle()

      // Step 1: as tc-writer, remove the blocked-by relation between #2 and #1.
      b.issue.blockedBy = []
      await deliver('issue_dependencies', {
        action: 'blocked_by_removed',
        blocked_issue: issueJson(s, b.issue),
        blocking_issue: issueJson(s, a.issue),
      })

      // Step 2: #2 is blocked by #1 again; B is still blocked by A.
      expect(d.github.issues.issue(s.full, 2).blockedBy).toEqual([a.issue.id])
      const blockers = await d.x.db
        .select({ blockerId: taskBlockedBy.blockerId })
        .from(taskBlockedBy)
        .where(eq(taskBlockedBy.taskId, b.id))
      expect(blockers).toEqual([{ blockerId: a.id }])
      expect(d.errors).toEqual([])
    })

    it('TC-147: a new issue opened on GitHub becomes an unscheduled task (end to end: webhook)', async () => {
      const s = await apolloWithRepo()

      // Step 1: as tc-writer, open issue "Crash on start".
      const issue = d.github.issues.createIssue(s.full, 'Crash on start')
      await deliver('issues', { action: 'opened', issue: issueJson(s, issue) })

      // Step 2: Apollo has a task linked to it, with no planned dates.
      const list = await d.x.db.select().from(tasks).where(eq(tasks.projectId, s.projectId))
      expect(list).toEqual([
        expect.objectContaining({
          title: 'Crash on start',
          plannedStart: null,
          plannedFinish: null,
        }),
      ])
      expect(d.errors).toEqual([])
    })

    it('rejects an unsigned delivery, a wrongly signed one and one from a sender with no secret, without any effect', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      close(t.issue)
      const asked = d.github.requests.length
      const payload = { action: 'closed', issue: issueJson(s, t.issue) }

      const refusals = [
        await deliver('issues', payload, { secret: null }),
        await deliver('issues', payload, { secret: 'not-the-secret' }),
        // The repository webhook's secret does not sign for the App, nor the App's for it.
        await deliver('issues', payload, { secret: REPOSITORY_SECRET }),
        await deliver('issues', payload, { secret: APP_SECRET, from: 'repository' }),
      ]
      expect(refusals.map((r) => r.statusCode)).toEqual([401, 401, 401, 401])
      expect(await readTask(t.id)).toMatchObject({ status: 'not-started' })
      expect(d.github.requests.length).toBe(asked)
      expect(await githubEntries()).toEqual([])
    })

    it('rejects a delivery from an App that has no webhook secret configured', async () => {
      const receiver = new GitHubWebhookReceiver(
        d.x.db,
        { apps: { readIssues: { ...app, webhookSecret: undefined } }, webhookSecret: undefined },
        d.handler,
        d.github.client,
      )
      const body = Buffer.from('{}')
      const signature = `sha256=${createHmac('sha256', APP_SECRET).update(body).digest('hex')}`
      const headers = { event: 'issues', signature, targetId: String(APP_ID) }
      expect(receiver.receive({ ...headers, targetType: 'integration' }, body, {})).toBe(
        'no-secret',
      )
      expect(receiver.receive({ ...headers, targetType: 'repository' }, body, {})).toBe('no-secret')
    })
  })

  describe('by the re-check (SC-024)', () => {
    const minutes = (m: number) => new Date(d.clock.now.getTime() + m * 60_000)

    it('TC-148: the hourly re-check catches a change whose notification never arrived', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      // The re-check last ran just now; the App's event delivery is off for the test, so no
      // webhook reaches the tool.
      expect(await d.timer.tick()).toBe(true)
      const start = d.clock.now

      // Step 1: as tc-writer, close #1 as completed.
      close(t.issue)

      // Step 2: read T at once: it is still in progress, and no re-check is due yet.
      expect(await readTask(t.id)).toMatchObject({ status: 'in-progress' })
      d.clock.now = minutes(59)
      expect(await d.timer.tick()).toBe(false)
      expect(await readTask(t.id)).toMatchObject({ status: 'in-progress' })

      // Step 3: 60 minutes after step 1, T is done with an actual finish, as had the close
      // arrived at once; the re-check does not reopen #1.
      d.clock.now = new Date(start.getTime() + 60 * 60_000)
      expect(await d.timer.tick()).toBe(true)
      expect(await readTask(t.id)).toMatchObject({ status: 'done', actualFinish: today })
      expect(d.github.issues.issue(s.full, 1).state).toBe('closed')
      expect(d.errors).toEqual([])
    })

    it('records a change it finds under whoever GitHub names for it', async () => {
      const s = await apolloWithRepo()
      const closed = await linked(s, 'Closed')
      const reopened = await linked(s, 'Reopened')
      const moved = await linked(s, 'Moved')
      await d.services.taskStatus.setStatus(by(d.alice), reopened.id, 'in-progress')
      close(reopened.issue)
      await d.handler.issueChanged({ owner: s.owner, name: s.name }, 2, 'tc-closer')
      expect(await readTask(reopened.id)).toMatchObject({ status: 'done' })
      await d.x.db.delete(auditLog)

      await d.services.taskStatus.setStatus(by(d.alice), closed.id, 'in-progress')
      close(closed.issue, 'completed', 'tc-writer')
      reopened.issue.state = 'open'
      reopened.issue.stateReason = null
      reopened.issue.events.push(
        { event: 'reopened', actor: 'tc-early' },
        { event: 'closed', actor: 'tc-closer' },
        { event: 'reopened', actor: 'tc-reopener' },
      )
      d.github.issues.addToProject(s.full, 3, { status: 'In Progress' })
      expect(await d.timer.tick()).toBe(true)

      expect(await readTask(closed.id)).toMatchObject({ status: 'done' })
      expect(await readTask(reopened.id)).toMatchObject({ status: 'in-progress' })
      expect(await readTask(moved.id)).toMatchObject({ status: 'in-progress' })
      const entries = await githubEntries()
      const loginOf = (taskId: string) =>
        entries.filter((e) => e.subjectId === taskId).map((e) => e.actorGithubLogin)
      expect(loginOf(closed.id)).toEqual(['tc-writer'])
      expect(loginOf(reopened.id)).toEqual(['tc-reopener'])
      // GitHub names no one for a move in the Projects status field.
      expect(loginOf(moved.id)).toEqual([RECHECK_ACTOR])
      expect(d.errors).toEqual([])
    })

    it('names no one GitHub does not name for a deleted issue', async () => {
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      d.github.issues.deleteIssue(s.full, 1)
      expect(await d.timer.tick()).toBe(true)
      expect(await readTask(t.id)).toMatchObject({ status: 'done' })
      const entries = await githubEntries()
      expect(entries.map((e) => e.actorGithubLogin)).toEqual([RECHECK_ACTOR])
    })

    it('mirrors every task again, putting right what the mirror failed to write', async () => {
      await d.services.githubLinks.link(by(d.alice), d.alice.id, 'tc-alice')
      const s = await apolloWithRepo()
      const t = await linked(s, 'T')
      d.github.cutOffAfter(0)
      await d.services.tasks.updateTask(by(d.alice), t.id, { assignees: [d.alice.id] })
      await d.mirror.idle()
      expect(t.issue.assignees).toEqual([])
      d.github.restore()
      d.errors.length = 0

      expect(await d.timer.tick()).toBe(true)
      expect(d.github.issues.issue(s.full, 1).assignees).toEqual(['tc-alice'])
      expect(d.errors).toEqual([])
    })

    it('goes on with the next linked issue when one fails', async () => {
      // The re-check takes the issues in by repository name: the one it cannot reach comes first.
      const other = await apolloWithRepo('a-unreachable')
      await linked(other, 'Elsewhere')
      d.github.uninstall(other.full)
      const s = await apolloWithRepo('b-repo')
      const t = await linked(s, 'T')
      await d.services.taskStatus.setStatus(by(d.alice), t.id, 'in-progress')
      close(t.issue)

      expect(await d.timer.tick()).toBe(true)
      expect(await readTask(t.id)).toMatchObject({ status: 'done' })
      expect(d.errors.length).toBeGreaterThan(0)
    })

    it('stores the time of its last run, so that a restart runs it only once it is due', async () => {
      let runs = 0
      const timer = (now: Date) =>
        new RecheckTimer(d.x.db, async () => void runs++, { intervalMinutes: 60, now: () => now })
      const at = new Date('2026-11-16T09:00:00Z')

      expect(await timer(at).tick()).toBe(true)
      const [stored] = await d.x.db.select().from(recheckRuns)
      expect(stored?.lastRunAt).toEqual(at)
      // A restart 30 minutes later does not run it; one 61 minutes later does.
      expect(await timer(new Date(at.getTime() + 30 * 60_000)).tick()).toBe(false)
      expect(await timer(new Date(at.getTime() + 61 * 60_000)).tick()).toBe(true)
      expect(runs).toBe(2)
    })

    it('runs at once on start if the last run is older than the interval', async () => {
      await d.x.db
        .insert(recheckRuns)
        .values({ id: 1, lastRunAt: new Date('2026-11-16T07:00:00Z') })
      const ran = Promise.withResolvers<void>()
      const timer = new RecheckTimer(d.x.db, async () => ran.resolve(), {
        intervalMinutes: 60,
        now: () => new Date('2026-11-16T09:00:00Z'),
      })
      timer.start()
      await ran.promise
      await timer.stop()
      const [stored] = await d.x.db.select().from(recheckRuns)
      expect(stored?.lastRunAt).toEqual(new Date('2026-11-16T09:00:00Z'))
    })

    it('lets only one backend instance run it at a time', async () => {
      const release = Promise.withResolvers<void>()
      const started = Promise.withResolvers<void>()
      let runs = 0
      const run = async () => {
        runs++
        started.resolve()
        await release.promise
      }
      const now = () => new Date('2026-11-16T09:00:00Z')
      const first = new RecheckTimer(d.x.db, run, { intervalMinutes: 60, now })
      const second = new RecheckTimer(d.x.db, run, { intervalMinutes: 60, now })

      const running = first.tick()
      await started.promise
      expect(await second.tick()).toBe(false)
      release.resolve()
      expect(await running).toBe(true)
      // Once the first has run, the second finds the run recent.
      expect(await second.tick()).toBe(false)
      expect(runs).toBe(1)
    })
  })
})
