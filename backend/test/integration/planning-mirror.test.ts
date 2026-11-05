import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { taskIssues } from '../../src/db/schema.ts'
import { GitHubPlanningMirror } from '../../src/github/planning-mirror.ts'
import type { Caller } from '../../src/service/caller.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { Task } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import type { FakeIssue } from '../helpers/github-issues.ts'
import { grantRole } from '../helpers/projects.ts'

// The GitHub planning mirror (SC-022) against a real PostgreSQL and a fake GitHub: the test cases
// of FR-089 and FR-090 through the REST API, then the mirror's edges through the service layer.
// The GitHub issue creator (SC-060) is not built yet, so each task's issue is opened on the fake
// GitHub and linked to the task here, as the test cases' "so it has issue #1" describes. Each
// change is mirrored at once, in the background; the tests wait for the mirror to be idle, well
// within the hour the test cases allow.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

interface Deployment {
  x: TestDatabase
  github: FakeGitHub
  mirror: GitHubPlanningMirror
  services: Services
  app: ReturnType<typeof buildApp>
  errors: unknown[]
  alice: Seeded
  bob: Seeded
}

/** A fresh test deployment, first system admin `root`, with accounts `alice` and `bob`. */
async function deploy(): Promise<Deployment> {
  const x = await createTestDatabase()
  const github = fakeGitHub()
  const errors: unknown[] = []
  const mirror = new GitHubPlanningMirror(x.db, github.client, {
    onError: (error) => errors.push(error),
  })
  const services = createServices(x.db, { github: github.reach, planningChanges: mirror })
  const app = buildApp({}, { authenticators: [testAuthenticator], services })
  await seedAccount(x.db, { username: 'root', systemAdmin: true })
  const alice = await seedAccount(x.db, { username: 'alice' })
  const bob = await seedAccount(x.db, { username: 'bob' })
  return { x, github, mirror, services, app, errors, alice, bob }
}

describe('test cases through the REST API', () => {
  let d: Deployment

  beforeEach(async () => {
    d = await deploy()
  })

  afterEach(async () => {
    await d?.mirror.idle()
    await d?.app.close()
    await d?.x.drop()
  })

  /**
   * `tc-repo` on GitHub with the tool's App installed, registered by alice and added to project
   * Apollo, created by alice; alice is admin of both, so it is added at once (FR-170).
   */
  async function apolloWithRepo(): Promise<{ apollo: string; repo: string }> {
    d.github.createRepository('csillagu/tc-repo')
    const registered = await d.app.inject({
      method: 'POST',
      url: '/api/repositories',
      headers: as(d.alice),
      payload: { owner: 'csillagu', name: 'tc-repo' },
    })
    expect(registered.statusCode).toBe(201)
    const repo = registered.json<RegisteredRepository>().id
    const created = await d.app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: as(d.alice),
      payload: { name: 'Apollo' },
    })
    expect(created.statusCode).toBe(201)
    const apollo = created.json<{ id: string }>().id
    const added = await d.app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/repository-requests`,
      headers: as(d.alice),
      payload: { repositoryId: repo },
    })
    expect(added.json()).toMatchObject({ state: 'approved' })
    return { apollo, repo }
  }

  /** A task of Apollo assigned to tc-repo, with its issue on GitHub linked to it. */
  async function taskWithIssue(
    apollo: string,
    repo: string,
    fields: Record<string, unknown>,
  ): Promise<{ task: Task; issue: FakeIssue }> {
    const created = await d.app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/tasks`,
      headers: as(d.alice),
      payload: fields,
    })
    expect(created.statusCode).toBe(201)
    const task = created.json<Task>()
    const assigned = await d.app.inject({
      method: 'PUT',
      url: `/api/tasks/${task.id}/repository`,
      headers: as(d.alice),
      payload: { repositoryId: repo },
    })
    expect(assigned.statusCode).toBe(200)
    const issue = d.github.issues.createIssue('csillagu/tc-repo')
    await d.x.db
      .insert(taskIssues)
      .values({ taskId: task.id, repositoryId: repo, number: issue.number, githubId: issue.id })
    return { task, issue }
  }

  const linkGitHub = (account: Seeded, login: string) =>
    d.app.inject({
      method: 'PUT',
      url: `/api/accounts/${account.id}/github`,
      headers: as(account),
      payload: { githubLogin: login },
    })

  it('TC-126: a subtask relation is mirrored to GitHub as a sub-issue', async () => {
    const { apollo, repo } = await apolloWithRepo()
    const parent = await taskWithIssue(apollo, repo, { title: 'Parent' })
    const child = await taskWithIssue(apollo, repo, { title: 'Child' })
    expect([parent.issue.number, child.issue.number]).toEqual([1, 2])

    // Step 1: as alice, make Child a subtask of Parent.
    const response = await d.app.inject({
      method: 'PUT',
      url: `/api/tasks/${child.task.id}/parent`,
      headers: as(d.alice),
      payload: { parentId: parent.task.id },
    })
    expect(response.statusCode).toBe(200)

    // Step 2: read #1's sub-issues on GitHub.
    await d.mirror.idle()
    const subIssues = await d.github.client().rest(
      'readIssues',
      { owner: 'csillagu', name: 'tc-repo' },
      {
        method: 'GET',
        path: ['issues', 1, 'sub_issues'],
      },
    )
    expect(subIssues.data).toEqual([expect.objectContaining({ number: 2 })])
    // No other sub-issue relation is added on GitHub.
    expect(d.github.issues.subIssues('csillagu/tc-repo', 2)).toEqual([])
    expect(d.github.issues.issue('csillagu/tc-repo', 1).parent).toBeUndefined()
    expect(d.errors).toEqual([])
  })

  it('TC-127: a blocked-by relation is mirrored to GitHub', async () => {
    const { apollo, repo } = await apolloWithRepo()
    const a = await taskWithIssue(apollo, repo, { title: 'A' })
    const b = await taskWithIssue(apollo, repo, { title: 'B' })

    // Step 1: as alice, make B blocked by A.
    const response = await d.app.inject({
      method: 'POST',
      url: `/api/tasks/${b.task.id}/blocked-by`,
      headers: as(d.alice),
      payload: { blockerId: a.task.id },
    })
    expect(response.statusCode).toBe(200)

    // Step 2: read #2's blocked-by relations on GitHub.
    await d.mirror.idle()
    const blockedBy = await d.github.client().rest(
      'readIssues',
      { owner: 'csillagu', name: 'tc-repo' },
      {
        method: 'GET',
        path: ['issues', 2, 'dependencies', 'blocked_by'],
      },
    )
    expect(blockedBy.data).toEqual([expect.objectContaining({ number: 1 })])
    // #1 is not marked as blocked by #2.
    expect(d.github.issues.issue('csillagu/tc-repo', 1).blockedBy).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('TC-128: assigned people are mirrored to GitHub as assignees', async () => {
    expect((await linkGitHub(d.alice, 'tc-alice')).statusCode).toBe(200)
    const { apollo, repo } = await apolloWithRepo()
    const t = await taskWithIssue(apollo, repo, { title: 'T' })

    // Step 1: as alice, assign alice to T.
    const response = await d.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${t.task.id}`,
      headers: as(d.alice),
      payload: { assignees: [d.alice.id] },
    })
    expect(response.statusCode).toBe(200)

    // Step 2: #1's assignees are exactly [tc-alice], and no other GitHub user is assigned.
    await d.mirror.idle()
    const issue = await d.github.client().rest(
      'readIssues',
      { owner: 'csillagu', name: 'tc-repo' },
      {
        method: 'GET',
        path: ['issues', 1],
      },
    )
    expect(issue.data).toMatchObject({ assignees: [{ login: 'tc-alice' }] })
    expect(d.errors).toEqual([])
  })

  it("TC-129: a milestone's fixed date is mirrored to GitHub", async () => {
    // A milestone's variant cannot change once it is created (FR-194), so M is a fixed-date
    // milestone from the start, and the change pins it to another date.
    const { apollo, repo } = await apolloWithRepo()
    const m = await taskWithIssue(apollo, repo, {
      title: 'M',
      milestone: { variant: 'fixed-date', date: '2027-03-05' },
    })

    // Step 1: as alice, pin M to the fixed date 2027-03-12.
    const response = await d.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${m.task.id}`,
      headers: as(d.alice),
      payload: { milestone: { variant: 'fixed-date', date: '2027-03-12' } },
    })
    expect(response.statusCode).toBe(200)

    // Step 2: #1 carries the fixed date 2027-03-12, as the due date of the milestone it is in.
    await d.mirror.idle()
    const issue = await d.github.client().rest(
      'readIssues',
      { owner: 'csillagu', name: 'tc-repo' },
      {
        method: 'GET',
        path: ['issues', 1],
      },
    )
    // GitHub keeps a due date as a time on that day; the date is the day's.
    expect(issue.data).toMatchObject({
      milestone: { due_on: expect.stringMatching(/^2027-03-12T/) },
    })
    // No other date is shown on #1 as its fixed date: the issue is in one milestone, and the
    // repository has no other.
    expect(d.github.issues.milestone('csillagu/tc-repo', 2)).toBeUndefined()
    expect(d.errors).toEqual([])
  })

  it("TC-130: a person without a linked GitHub account is left off the issue's assignees", async () => {
    expect((await linkGitHub(d.alice, 'tc-alice')).statusCode).toBe(200)
    const { apollo, repo } = await apolloWithRepo()
    await grantRole(d.x.db, d.bob, apollo, 'read-only')
    const t = await taskWithIssue(apollo, repo, { title: 'T' })

    // Step 1: as alice, assign alice and bob to T. The change is not rejected.
    const response = await d.app.inject({
      method: 'PATCH',
      url: `/api/tasks/${t.task.id}`,
      headers: as(d.alice),
      payload: { assignees: [d.alice.id, d.bob.id] },
    })
    expect(response.statusCode).toBe(200)

    // Step 2: #1's assignees are exactly [tc-alice]; T's assigned people are [alice, bob].
    await d.mirror.idle()
    expect(d.github.issues.issue('csillagu/tc-repo', 1).assignees).toEqual(['tc-alice'])
    const read = await d.app.inject({
      method: 'GET',
      url: `/api/tasks/${t.task.id}`,
      headers: as(d.alice),
    })
    expect(read.json<Task>().assignees).toEqual([d.alice.id, d.bob.id])
    expect(d.errors).toEqual([])
  })
})

describe('the GitHub planning mirror', () => {
  let d: Deployment
  let n = 0

  beforeEach(async () => {
    d = await deploy()
  })

  afterEach(async () => {
    await d?.mirror.idle()
    await d?.app.close()
    await d?.x.drop()
  })

  /** A repository on GitHub registered by alice, and a project of alice's that pulls from it. */
  async function setUp(): Promise<{ projectId: string; repo: RegisteredRepository; full: string }> {
    const full = `octo-${++n}/repo-${n}`
    const [owner = '', name = ''] = full.split('/')
    d.github.createRepository(full)
    const repo = await d.services.repositories.registerRepository(by(d.alice), { owner, name })
    const project = await d.services.projects.createProject(by(d.alice), { name: `P-${n}` })
    await d.services.projectRepositories.requestRepository(by(d.alice), project.id, repo.id)
    return { projectId: project.id, repo, full }
  }

  async function linked(
    setup: { projectId: string; repo: RegisteredRepository; full: string },
    fields: Record<string, unknown> = {},
  ): Promise<{ id: string; issue: FakeIssue }> {
    const task = await d.services.tasks.createTask(by(d.alice), setup.projectId, {
      title: `Task ${++n}`,
      ...fields,
    })
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, setup.repo.id)
    const issue = d.github.issues.createIssue(setup.full)
    await d.x.db.insert(taskIssues).values({
      taskId: task.id,
      repositoryId: setup.repo.id,
      number: issue.number,
      githubId: issue.id,
    })
    return { id: task.id, issue }
  }

  it('takes a subtask off its parent issue when it is no longer a subtask', async () => {
    const s = await setUp()
    const parent = await linked(s)
    const child = await linked(s)
    await d.services.taskRelations.setParent(by(d.alice), child.id, parent.id)
    await d.mirror.idle()
    expect(child.issue.parent).toBe(parent.issue.id)

    await d.services.taskRelations.setParent(by(d.alice), child.id, null)
    await d.mirror.idle()
    expect(child.issue.parent).toBeUndefined()
    expect(d.errors).toEqual([])
  })

  it('moves a subtask to its new parent issue', async () => {
    const s = await setUp()
    const first = await linked(s)
    const second = await linked(s)
    const child = await linked(s)
    await d.services.taskRelations.setParent(by(d.alice), child.id, first.id)
    await d.services.taskRelations.setParent(by(d.alice), child.id, second.id)
    await d.mirror.idle()
    expect(child.issue.parent).toBe(second.issue.id)
    expect(d.errors).toEqual([])
  })

  it('removes a blocked-by relation the tool no longer holds, and one added on GitHub', async () => {
    const s = await setUp()
    const a = await linked(s)
    const b = await linked(s)
    const c = await linked(s)
    await d.services.taskRelations.addBlocker(by(d.alice), c.id, a.id)
    await d.mirror.idle()
    expect(c.issue.blockedBy).toEqual([a.issue.id])

    // Someone adds a relation on GitHub that the tool does not hold; the next mirror takes it off.
    c.issue.blockedBy.push(b.issue.id)
    await d.services.taskRelations.removeBlocker(by(d.alice), c.id, a.id)
    await d.mirror.idle()
    expect(c.issue.blockedBy).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('mirrors the blockers a cancellation passes on to the tasks the cancelled one blocked', async () => {
    const s = await setUp()
    const first = await linked(s)
    const middle = await linked(s)
    const last = await linked(s)
    await d.services.taskRelations.addBlocker(by(d.alice), middle.id, first.id)
    await d.services.taskRelations.addBlocker(by(d.alice), last.id, middle.id)
    await d.mirror.idle()
    expect(last.issue.blockedBy).toEqual([middle.issue.id])

    await d.services.taskCancellation.cancel(by(d.alice), middle.id)
    await d.mirror.idle()
    expect(last.issue.blockedBy).toEqual([first.issue.id])
    expect(d.errors).toEqual([])
  })

  it('leaves off a relation with a task that has no issue', async () => {
    const s = await setUp()
    const unlinked = await d.services.tasks.createTask(by(d.alice), s.projectId, { title: 'U' })
    const t = await linked(s)
    await d.services.taskRelations.addBlocker(by(d.alice), t.id, unlinked.id)
    await d.mirror.idle()
    expect(t.issue.blockedBy).toEqual([])
    expect(d.errors).toEqual([])
  })

  it("updates the issues' assignees when an assignee links their GitHub account", async () => {
    const s = await setUp()
    const t = await linked(s)
    await d.services.tasks.updateTask(by(d.alice), t.id, { assignees: [d.alice.id] })
    await d.mirror.idle()
    expect(t.issue.assignees).toEqual([])

    await d.services.githubLinks.link(by(d.alice), d.alice.id, 'tc-alice')
    await d.mirror.idle()
    expect(t.issue.assignees).toEqual(['tc-alice'])
    expect(d.errors).toEqual([])
  })

  it("moves the GitHub milestone's due date with the fixed date, keeping one milestone", async () => {
    const s = await setUp()
    const m = await linked(s, { milestone: { variant: 'fixed-date', date: '2027-03-05' } })
    const { title } = await d.services.tasks.getTask(by(d.alice), m.id)
    await d.mirror.mirrorAll()
    expect(m.issue.milestone).toBe(1)
    expect(d.github.issues.milestone(s.full, 1)).toMatchObject({ title: `${title} (#1)` })
    expect(d.github.issues.milestone(s.full, 1)?.dueOn?.slice(0, 10)).toBe('2027-03-05')

    await d.services.tasks.updateTask(by(d.alice), m.id, {
      milestone: { variant: 'fixed-date', date: '2027-03-12' },
    })
    await d.mirror.idle()
    expect(m.issue.milestone).toBe(1)
    expect(d.github.issues.milestone(s.full, 1)?.dueOn?.slice(0, 10)).toBe('2027-03-12')
    expect(d.github.issues.milestone(s.full, 2)).toBeUndefined()
    expect(d.errors).toEqual([])
  })

  it('leaves alone the issue of a task its project kept after a withdrawal (FR-182)', async () => {
    const s = await setUp()
    await d.services.githubLinks.link(by(d.alice), d.alice.id, 'tc-alice')
    const kept = await linked(s)
    const [request] = await d.services.projectRepositories.listProjectRequests(
      by(d.alice),
      s.projectId,
    )
    await d.services.projectRepositories.withdrawApproval(by(d.alice), request?.id ?? '')

    await d.services.tasks.updateTask(by(d.alice), kept.id, { assignees: [d.alice.id] })
    await d.mirror.mirrorAll()
    expect(kept.issue.assignees).toEqual([])
    expect(d.github.requests.filter((r) => r.includes(`/issues/${kept.issue.number}`))).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('tells of an issue it could not mirror, and goes on with the others', async () => {
    const s = await setUp()
    const other = await setUp()
    const failing = await linked(s)
    const t = await linked(other)
    await d.services.githubLinks.link(by(d.alice), d.alice.id, 'tc-alice')
    d.github.uninstall(s.full)
    await d.services.tasks.updateTask(by(d.alice), failing.id, { assignees: [d.alice.id] })
    await d.services.tasks.updateTask(by(d.alice), t.id, { assignees: [d.alice.id] })
    await d.mirror.idle()
    expect(d.errors).toHaveLength(1)
    expect(t.issue.assignees).toEqual(['tc-alice'])

    // Once the App is back, the re-check puts it right (DD-051).
    d.github.install(s.full)
    await d.mirror.mirrorAll()
    expect(failing.issue.assignees).toEqual(['tc-alice'])
    expect(d.errors).toHaveLength(1)
  })
})
