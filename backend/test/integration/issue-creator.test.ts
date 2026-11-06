import { eq } from 'drizzle-orm'
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

// The GitHub issue creator (SC-060) and the not-planned closer (SC-061) against a real PostgreSQL
// and a fake GitHub: the test cases of FR-088 and FR-130 through the REST API, then their edges
// through the service layer. Both run in the planning mirror's background queue (SC-022); the tests
// wait for it to be idle, well within the hour the test cases allow.

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

let d: Deployment

beforeEach(async () => {
  d = await deploy()
})

afterEach(async () => {
  await d?.mirror.idle()
  await d?.app.close()
  await d?.x.drop()
})

describe('test cases through the REST API', () => {
  /**
   * `tc-repo` on GitHub, with no issues and the tool's App installed, registered by alice and
   * added to project Apollo, created by alice; alice is admin of both, so it is added at once.
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

  async function createTask(apollo: string, fields: Record<string, unknown>): Promise<Task> {
    const created = await d.app.inject({
      method: 'POST',
      url: `/api/projects/${apollo}/tasks`,
      headers: as(d.alice),
      payload: fields,
    })
    expect(created.statusCode).toBe(201)
    return created.json<Task>()
  }

  const assign = (taskId: string, repo: string) =>
    d.app.inject({
      method: 'PUT',
      url: `/api/tasks/${taskId}/repository`,
      headers: as(d.alice),
      payload: { repositoryId: repo },
    })

  const readTask = async (taskId: string) => {
    const read = await d.app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: as(d.alice),
    })
    expect(read.statusCode).toBe(200)
    return read.json<Task>()
  }

  it('TC-124: a task assigned to a repository gets its GitHub issue there', async () => {
    const { apollo, repo } = await apolloWithRepo()
    // Another repository on GitHub, also pulled by Apollo, for the negative assertion.
    d.github.createRepository('csillagu/other-repo')
    const other = await d.services.repositories.registerRepository(by(d.alice), {
      owner: 'csillagu',
      name: 'other-repo',
    })
    await d.services.projectRepositories.requestRepository(by(d.alice), apollo, other.id)
    const task = await createTask(apollo, { title: 'Write guide' })
    expect(task.githubIssue).toBeNull()

    // Step 1: as alice, assign Write guide to tc-repo.
    expect((await assign(task.id, repo)).statusCode).toBe(200)

    // Step 2: within an hour, list the issues of tc-repo and read Write guide back.
    await d.mirror.idle()
    const issues = d.github.issues.issuesOf('csillagu/tc-repo')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ number: 1, title: 'Write guide', state: 'open' })
    expect((await readTask(task.id)).githubIssue).toEqual({ repositoryId: repo, number: 1 })
    // No issue is created in any other repository.
    expect(d.github.issues.issuesOf('csillagu/other-repo')).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('TC-125: a task not assigned to a repository has no GitHub issue', async () => {
    const { apollo } = await apolloWithRepo()

    // Step 1: as alice, create Local only.
    const task = await createTask(apollo, {
      title: 'Local only',
      plannedStart: '2027-03-01',
      durationWorkingDays: 2,
      eligibility: d.alice.id,
      assignees: [d.alice.id],
    })

    // Step 2: wait (the re-check standing in for the hour), list tc-repo's issues, read it back.
    await d.mirror.mirrorAll()
    expect((await readTask(task.id)).githubIssue).toBeNull()
    expect(d.github.issues.issuesOf('csillagu/tc-repo')).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('TC-193: cancelling a task closes its GitHub issue as not planned', async () => {
    const { apollo, repo } = await apolloWithRepo()
    const task = await createTask(apollo, { title: 'T' })
    expect((await assign(task.id, repo)).statusCode).toBe(200)
    await d.mirror.idle()
    const issue = d.github.issues.issue('csillagu/tc-repo', 1)
    expect(issue.state).toBe('open')

    // Step 1: as alice, cancel T in the tool.
    const cancelled = await d.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/cancel`,
      headers: as(d.alice),
    })
    expect(cancelled.statusCode).toBe(200)

    // Step 2: within an hour, read #1 on GitHub.
    await d.mirror.idle()
    expect(issue).toMatchObject({ state: 'closed', stateReason: 'not_planned' })
    // #1 is not closed as completed, and is not deleted.
    expect(d.github.issues.issuesOf('csillagu/tc-repo')).toEqual([issue])
    expect(d.errors).toEqual([])
  })
})

describe('the GitHub issue creator and not-planned closer', () => {
  let n = 0

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

  const links = () => d.x.db.select().from(taskIssues)

  it('creates no second issue when the task is assigned again, or to another repository', async () => {
    const s = await setUp()
    const other = await setUp()
    // The second project's repository, pulled by the first project as well.
    await d.services.projectRepositories.requestRepository(by(d.alice), s.projectId, other.repo.id)
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, { title: 'Once' })
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, other.repo.id)
    await d.mirror.mirrorAll()
    expect(d.github.issues.issuesOf(s.full)).toHaveLength(1)
    expect(d.github.issues.issuesOf(other.full)).toEqual([])
    expect(await links()).toMatchObject([{ taskId: task.id, repositoryId: s.repo.id, number: 1 }])
    expect(d.errors).toEqual([])
  })

  it('creates the issue the re-check finds missing, after GitHub could not be reached', async () => {
    const s = await setUp()
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, { title: 'Late' })
    d.github.uninstall(s.full)
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    expect(d.errors).toHaveLength(1)
    expect(await links()).toEqual([])

    d.github.install(s.full)
    await d.mirror.mirrorAll()
    expect(d.github.issues.issuesOf(s.full)).toMatchObject([{ title: 'Late' }])
    expect(await links()).toMatchObject([{ taskId: task.id, number: 1 }])
    expect(d.errors).toHaveLength(1)
  })

  it('creates no issue for a task whose project stopped pulling from the repository', async () => {
    const s = await setUp()
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, { title: 'Kept' })
    d.github.uninstall(s.full)
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    d.github.install(s.full)
    const [request] = await d.services.projectRepositories.listProjectRequests(
      by(d.alice),
      s.projectId,
    )
    await d.services.projectRepositories.withdrawApproval(by(d.alice), request?.id ?? '')

    await d.mirror.mirrorAll()
    expect(d.github.issues.issuesOf(s.full)).toEqual([])
    expect(await links()).toEqual([])
  })

  it('gives the new issue its planning at once', async () => {
    const s = await setUp()
    await d.services.githubLinks.link(by(d.alice), d.alice.id, 'tc-alice')
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, {
      title: 'Planned',
      eligibility: d.alice.id,
      assignees: [d.alice.id],
    })
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    expect(d.github.issues.issue(s.full, 1).assignees).toEqual(['tc-alice'])
    expect(d.errors).toEqual([])
  })

  it('closes as not planned an issue closed as completed on GitHub, and leaves one so already', async () => {
    const s = await setUp()
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, { title: 'Done?' })
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    const issue = d.github.issues.issue(s.full, 1)
    issue.state = 'closed'
    issue.stateReason = 'completed'

    await d.services.taskCancellation.cancel(by(d.alice), task.id)
    await d.mirror.idle()
    expect(issue).toMatchObject({ state: 'closed', stateReason: 'not_planned' })

    d.github.requests.length = 0
    await d.mirror.mirrorAll()
    expect(d.github.requests.filter((r) => r.startsWith('PATCH'))).toEqual([])
    expect(d.errors).toEqual([])
  })

  it('creates and closes the issue of a task assigned to a repository once cancelled', async () => {
    const s = await setUp()
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, { title: 'Gone' })
    await d.services.taskCancellation.cancel(by(d.alice), task.id)
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    expect(d.github.issues.issuesOf(s.full)).toMatchObject([
      { title: 'Gone', state: 'closed', stateReason: 'not_planned' },
    ])
    expect(d.errors).toEqual([])
  })

  it('leaves alone the issue of a cancelled task its project kept after a withdrawal', async () => {
    const s = await setUp()
    const task = await d.services.tasks.createTask(by(d.alice), s.projectId, { title: 'Kept' })
    await d.services.taskRepository.assignRepository(by(d.alice), task.id, s.repo.id)
    await d.mirror.idle()
    const [request] = await d.services.projectRepositories.listProjectRequests(
      by(d.alice),
      s.projectId,
    )
    await d.services.projectRepositories.withdrawApproval(by(d.alice), request?.id ?? '')
    await d.services.taskCancellation.cancel(by(d.alice), task.id)
    await d.mirror.idle()
    expect(d.github.issues.issue(s.full, 1).state).toBe('open')
    const [link] = await d.x.db.select().from(taskIssues).where(eq(taskIssues.taskId, task.id))
    expect(link?.number).toBe(1)
    expect(d.errors).toEqual([])
  })
})
