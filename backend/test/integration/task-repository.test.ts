import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import type { ServiceError } from '../../src/service/errors.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { NOT_PULLED_MESSAGE } from '../../src/service/task-repository.ts'
import type { Task } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The task repository assignment (SC-036) against a real PostgreSQL: its rules through the
// service, then the test cases of FR-141 through the REST API, with repositories registered
// through the registry (SC-019) against a fake GitHub and added to projects through the project
// repository approvals (SC-110).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

/** What a refusal of the given kind looks like, as the service throws it. */
const refusal = (kind: ServiceError['kind']) => expect.objectContaining({ kind })

/** How the service refuses a repository the task's project does not pull from (FR-141). */
const notPulled = expect.objectContaining({ kind: 'invalid', message: NOT_PULLED_MESSAGE })

const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000'

describe('the task repository assignment', () => {
  let x: TestDatabase
  let github: FakeGitHub
  let services: Services
  let alice: Seeded
  let bob: Seeded
  let n = 0

  beforeAll(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    services = createServices(x.db, { github: github.reach })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  /** A repository on GitHub, registered by `registrant`, under a name no other test uses. */
  async function repositoryOf(registrant: Seeded): Promise<RegisteredRepository> {
    const repo = github.createRepository(`Octo-${++n}/Repo-${n}`)
    return services.repositories.registerRepository(by(registrant), repo)
  }
  /** A project created by alice, its only admin, under a name no other test uses. */
  const project = () => seedProject(x.db, alice, `Project-${++n}`)
  /** A repository registered by alice, which the project pulls issues from at once (FR-170). */
  async function pulledBy(projectId: string): Promise<RegisteredRepository> {
    const repo = await repositoryOf(alice)
    await services.projectRepositories.requestRepository(by(alice), projectId, repo.id)
    return repo
  }
  const taskIn = async (projectId: string) =>
    (await services.tasks.createTask(by(alice), projectId, { title: `Task ${++n}` })).id
  const storedRepository = async (taskId: string) => {
    const [row] = await x.db
      .select({ repositoryId: tasks.repositoryId })
      .from(tasks)
      .where(eq(tasks.id, taskId))
    return row?.repositoryId
  }
  const entriesFor = (taskId: string) =>
    x.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.subjectId, taskId))
      .then((rows) => rows.filter((row) => row.action === 'task.repository-assigned'))
  const assign = (caller: Seeded, taskId: string, repositoryId: unknown) =>
    services.taskRepository.assignRepository(by(caller), taskId, repositoryId)

  describe('assigning to a repository the project pulls issues from', () => {
    it('assigns the task, answers it, and records the assignment in the audit log', async () => {
      const projectId = await project()
      const repo = await pulledBy(projectId)
      const taskId = await taskIn(projectId)

      const assigned = await assign(alice, taskId, repo.id)

      expect(assigned).toMatchObject({ id: taskId, projectId, repositoryId: repo.id })
      expect(await storedRepository(taskId)).toBe(repo.id)
      expect((await services.tasks.getTask(by(alice), taskId)).repositoryId).toBe(repo.id)
      expect(await entriesFor(taskId)).toMatchObject([
        {
          actorAccountId: alice.id,
          channels: ['ui'],
          projectId,
          subjectType: 'task',
          details: { repositoryId: repo.id, previous: null },
        },
      ])
    })

    it('accepts any of the repositories the project pulls from', async () => {
      const projectId = await project()
      const first = await pulledBy(projectId)
      const second = await pulledBy(projectId)
      const a = await taskIn(projectId)
      const b = await taskIn(projectId)

      expect((await assign(alice, a, first.id)).repositoryId).toBe(first.id)
      expect((await assign(alice, b, second.id)).repositoryId).toBe(second.id)
      const listed = await services.tasks.listTasks(by(alice), projectId)
      expect(listed.map((task) => [task.id, task.repositoryId])).toEqual([
        [a, first.id],
        [b, second.id],
      ])
    })

    it('accepts a repository the project pulls from once a repository admin approved it', async () => {
      const projectId = await project()
      const repo = await repositoryOf(bob)
      const request = await services.projectRepositories.requestRepository(
        by(alice),
        projectId,
        repo.id,
      )
      await services.projectRepositories.approveRequest(by(bob), request.id)
      const taskId = await taskIn(projectId)

      expect((await assign(alice, taskId, repo.id)).repositoryId).toBe(repo.id)
    })

    it('moves a task assigned to one pulled repository to another, recording the previous one', async () => {
      const projectId = await project()
      const first = await pulledBy(projectId)
      const second = await pulledBy(projectId)
      const taskId = await taskIn(projectId)
      await assign(alice, taskId, first.id)

      expect((await assign(alice, taskId, second.id)).repositoryId).toBe(second.id)
      expect((await entriesFor(taskId)).map((entry) => entry.details)).toEqual([
        { repositoryId: first.id, previous: null },
        { repositoryId: second.id, previous: first.id },
      ])
    })

    it('changes nothing, and records nothing, when the task is already assigned to it', async () => {
      const projectId = await project()
      const repo = await pulledBy(projectId)
      const taskId = await taskIn(projectId)
      await assign(alice, taskId, repo.id)

      expect((await assign(alice, taskId, repo.id)).repositoryId).toBe(repo.id)
      expect(await entriesFor(taskId)).toHaveLength(1)
    })

    it('leaves every other field of the task as it was', async () => {
      const projectId = await project()
      const repo = await pulledBy(projectId)
      const before = await services.tasks.createTask(by(alice), projectId, {
        title: 'Write the guide',
        description: 'All of it',
        plannedStart: '2027-03-01',
        durationWorkingDays: 3,
        assignees: [alice.id],
      })

      const after = await assign(alice, before.id, repo.id)

      expect(after).toEqual({ ...before, repositoryId: repo.id })
    })

    it('lets a read-write member assign a task', async () => {
      const projectId = await project()
      const repo = await pulledBy(projectId)
      const taskId = await taskIn(projectId)
      await grantRole(x.db, bob, projectId, 'read-write')

      expect((await assign(bob, taskId, repo.id)).repositoryId).toBe(repo.id)
    })

    it('keeps the assignment when the project stops pulling from the repository (FR-178)', async () => {
      const projectId = await project()
      const repo = await repositoryOf(bob)
      const request = await services.projectRepositories.requestRepository(
        by(alice),
        projectId,
        repo.id,
      )
      await services.projectRepositories.approveRequest(by(bob), request.id)
      const taskId = await taskIn(projectId)
      await assign(alice, taskId, repo.id)

      await services.projectRepositories.withdrawApproval(by(bob), request.id)

      expect(await services.projectRepositories.pulls(projectId, repo.id)).toBe(false)
      expect((await services.tasks.getTask(by(alice), taskId)).repositoryId).toBe(repo.id)
      // And it can no longer be assigned there again, once moved elsewhere.
      const other = await pulledBy(projectId)
      await assign(alice, taskId, other.id)
      await expect(assign(alice, taskId, repo.id)).rejects.toEqual(refusal('invalid'))
    })
  })

  describe('refusing any other repository', () => {
    /** The task's repository, and how many assignments of it the audit log holds. */
    const stateOf = async (taskId: string) => ({
      repositoryId: await storedRepository(taskId),
      assignments: (await entriesFor(taskId)).length,
    })
    const UNASSIGNED = { repositoryId: null, assignments: 0 }

    it('refuses a registered repository the project has not asked for', async () => {
      const projectId = await project()
      const repo = await repositoryOf(bob)
      const taskId = await taskIn(projectId)
      await expect(assign(alice, taskId, repo.id)).rejects.toEqual(notPulled)
      expect(await stateOf(taskId)).toEqual(UNASSIGNED)
    })

    it('refuses a repository whose request is still waiting for approval', async () => {
      const projectId = await project()
      const repo = await repositoryOf(bob)
      await services.projectRepositories.requestRepository(by(alice), projectId, repo.id)
      const taskId = await taskIn(projectId)
      await expect(assign(alice, taskId, repo.id)).rejects.toEqual(notPulled)
      expect(await stateOf(taskId)).toEqual(UNASSIGNED)
    })

    it('refuses a repository whose request was rejected', async () => {
      const projectId = await project()
      const repo = await repositoryOf(bob)
      const request = await services.projectRepositories.requestRepository(
        by(alice),
        projectId,
        repo.id,
      )
      await services.projectRepositories.rejectRequest(by(bob), request.id)
      const taskId = await taskIn(projectId)
      await expect(assign(alice, taskId, repo.id)).rejects.toEqual(notPulled)
      expect(await stateOf(taskId)).toEqual(UNASSIGNED)
    })

    it('refuses a repository whose approval was withdrawn (FR-181)', async () => {
      const projectId = await project()
      const repo = await repositoryOf(bob)
      const request = await services.projectRepositories.requestRepository(
        by(alice),
        projectId,
        repo.id,
      )
      await services.projectRepositories.approveRequest(by(bob), request.id)
      await services.projectRepositories.withdrawApproval(by(bob), request.id)
      const taskId = await taskIn(projectId)
      await expect(assign(alice, taskId, repo.id)).rejects.toEqual(notPulled)
      expect(await stateOf(taskId)).toEqual(UNASSIGNED)
    })

    it('refuses a repository another project pulls from, but not this one', async () => {
      const projectId = await project()
      const other = await project()
      const repo = await pulledBy(other)
      const taskId = await taskIn(projectId)
      await expect(assign(alice, taskId, repo.id)).rejects.toEqual(notPulled)
      expect(await stateOf(taskId)).toEqual(UNASSIGNED)
    })

    it('refuses an id no repository has, and a value that is no id', async () => {
      const taskId = await taskIn(await project())
      for (const value of [NO_SUCH_ID, 'not-an-id', '', null, undefined, 42, { id: NO_SUCH_ID }]) {
        await expect(assign(alice, taskId, value)).rejects.toEqual(notPulled)
        expect(await stateOf(taskId)).toEqual(UNASSIGNED)
      }
    })

    it('leaves a task assigned to a pulled repository where it was', async () => {
      const projectId = await project()
      const repo = await pulledBy(projectId)
      const elsewhere = await repositoryOf(bob)
      const taskId = await taskIn(projectId)
      await assign(alice, taskId, repo.id)

      await expect(assign(alice, taskId, elsewhere.id)).rejects.toEqual(refusal('invalid'))

      expect(await storedRepository(taskId)).toBe(repo.id)
      expect(await entriesFor(taskId)).toHaveLength(1)
    })
  })

  describe('who may assign', () => {
    it.each(['contributor', 'read-only'] as const)(
      'refuses a %s as forbidden, before looking at the repository',
      async (role) => {
        const projectId = await project()
        const repo = await pulledBy(projectId)
        const taskId = await taskIn(projectId)
        await grantRole(x.db, bob, projectId, role)

        await expect(assign(bob, taskId, repo.id)).rejects.toEqual(refusal('forbidden'))
        await expect(assign(bob, taskId, NO_SUCH_ID)).rejects.toEqual(refusal('forbidden'))
        expect(await storedRepository(taskId)).toBeNull()
      },
    )

    it('tells someone with no role in the project that it is not visible to them', async () => {
      const projectId = await project()
      const repo = await pulledBy(projectId)
      const taskId = await taskIn(projectId)

      await expect(assign(bob, taskId, repo.id)).rejects.toEqual(refusal('not-visible'))
      expect(await storedRepository(taskId)).toBeNull()
    })

    it('refuses a project admin of another project as not visible', async () => {
      const projectId = await project()
      const repo = await pulledBy(projectId)
      const taskId = await taskIn(projectId)
      // bob is admin of a project of his own, which pulls from nothing.
      await seedProject(x.db, bob, `Project-${++n}`)

      await expect(assign(bob, taskId, repo.id)).rejects.toEqual(refusal('not-visible'))
    })

    it('refuses a task that does not exist, or an id that is no id, as not found', async () => {
      const repo = await pulledBy(await project())
      await expect(assign(alice, NO_SUCH_ID, repo.id)).rejects.toEqual(refusal('not-found'))
      await expect(assign(alice, 'not-an-id', repo.id)).rejects.toEqual(refusal('not-found'))
    })
  })

  describe('the table', () => {
    it('refuses a repository id that names no registered repository', async () => {
      const taskId = await taskIn(await project())
      // 23503: a foreign key is violated.
      await expect(
        x.db.update(tasks).set({ repositoryId: NO_SUCH_ID }).where(eq(tasks.id, taskId)),
      ).rejects.toMatchObject({ cause: { code: '23503' } })
      expect(await storedRepository(taskId)).toBeNull()
    })
  })
})

describe('test cases through the REST API', () => {
  // Each test case starts from its own fresh test deployment, as the test cases ask.
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let github: FakeGitHub
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    const services = createServices(x.db, { github: github.reach })
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  /** `fullName` on GitHub with the tool's App installed, registered in the tool by `registrant`. */
  async function registeredBy(registrant: Seeded, fullName: string): Promise<string> {
    const [owner, name] = fullName.split('/')
    github.createRepository(fullName)
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories',
      headers: as(registrant),
      payload: { owner, name },
    })
    expect(response.statusCode).toBe(201)
    return response.json<RegisteredRepository>().id
  }
  /** A project created through the API by `creator`, as the test cases' "created by" says. */
  async function createdBy(creator: Seeded, name: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: as(creator),
      payload: { name },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }
  async function taskIn(account: Seeded, projectId: string, title: string): Promise<Task> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tasks`,
      headers: as(account),
      payload: { title },
    })
    expect(response.statusCode).toBe(201)
    return response.json<Task>()
  }
  const assign = (account: Seeded, taskId: string, repositoryId: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/tasks/${taskId}/repository`,
      headers: as(account),
      payload: { repositoryId },
    })
  async function read(account: Seeded, taskId: string): Promise<Task> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: as(account),
    })
    expect(response.statusCode).toBe(200)
    return response.json<Task>()
  }

  describe('TC-208: a task is assigned to a repository its project pulls issues from', () => {
    it('assigns T to tc-repo, and to no other repository', async () => {
      // tc-repo, registered by alice and added to Apollo, created by alice, as a repository it
      // pulls issues from; alice is admin of both, so it is added at once (FR-170).
      const tcRepo = await registeredBy(alice, 'csillagu/tc-repo')
      const apollo = await createdBy(alice, 'Apollo')
      const added = await app.inject({
        method: 'POST',
        url: `/api/projects/${apollo}/repository-requests`,
        headers: as(alice),
        payload: { repositoryId: tcRepo },
      })
      expect(added.statusCode).toBe(201)
      expect(added.json()).toMatchObject({ state: 'approved' })
      // A second registered repository Apollo does not pull from, for the negative assertion.
      const elsewhere = await registeredBy(alice, 'csillagu/tc-elsewhere')
      const t = await taskIn(alice, apollo, 'T')
      expect(t.repositoryId).toBeNull()

      // Step 1: as alice, assign T to tc-repo.
      const assigned = await assign(alice, t.id, tcRepo)
      expect(assigned.statusCode).toBe(200)

      // Step 2: read T. It is assigned to tc-repo, and to no other repository.
      const read2 = await read(alice, t.id)
      expect(read2.repositoryId).toBe(tcRepo)
      expect(read2.repositoryId).not.toBe(elsewhere)
    })
  })

  describe('TC-209: assigning a task to a repository its project does not pull from is rejected', () => {
    it('rejects assigning T to tc-other, leaving T unassigned and tc-other without a new issue', async () => {
      // tc-other, registered by bob and not added to Apollo, created by alice.
      const tcOther = await registeredBy(bob, 'csillagu/tc-other')
      const apollo = await createdBy(alice, 'Apollo')
      const t = await taskIn(alice, apollo, 'T')
      const before = github.requests.length

      // Step 1: as alice, try to assign T to tc-other. The assignment is rejected.
      const tried = await assign(alice, t.id, tcOther)
      expect(tried.statusCode).toBe(400)
      expect(tried.json()).toMatchObject({ message: NOT_PULLED_MESSAGE })

      // Step 2: read T and the issues of tc-other. T is assigned to no repository, and nothing
      // was sent to GitHub, so tc-other has no new issue.
      expect((await read(alice, t.id)).repositoryId).toBeNull()
      expect(github.requests.slice(before)).toEqual([])
    })
  })

  describe('the route, end to end', () => {
    it('answers 404 for a task that does not exist, and 403 to a contributor', async () => {
      const repo = await registeredBy(alice, 'csillagu/tc-repo')
      const apollo = await createdBy(alice, 'Apollo')
      const t = await taskIn(alice, apollo, 'T')
      await grantRole(x.db, bob, apollo, 'contributor')

      expect((await assign(alice, NO_SUCH_ID, repo)).statusCode).toBe(404)
      expect((await assign(bob, t.id, repo)).statusCode).toBe(403)
    })
  })
})
