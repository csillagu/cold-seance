import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  auditLog,
  groupMembers,
  groupProjects,
  groups,
  projectMembers,
  projectRepositoryRequests,
  repositories,
  repositoryAdmins,
  tasks,
} from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type {
  ProjectRepository,
  ProjectRepositoryService,
  RepositoryRequest,
} from '../../src/service/project-repositories.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The project repository approvals (SC-110) against a real PostgreSQL: their rules through the
// service, then the test cases of FR-142, FR-168, FR-170, FR-171 and FR-172 through the REST API,
// with repositories registered through the registry (SC-019) against a fake GitHub.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: { id: string }): Caller => ({ accountId: account.id, channel: 'ui' })

async function refused(promise: Promise<unknown>, kind: ServiceError['kind']) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError)) {
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  }
  expect(error.kind).toBe(kind)
  return error
}

const NO_SUCH_ID = '00000000-0000-4000-8000-000000000000'

describe('the project repository service', () => {
  let x: TestDatabase
  let github: FakeGitHub
  let services: Services
  let service: ProjectRepositoryService
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded
  let dave: Seeded
  let root: Seeded
  let n = 0

  beforeAll(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    services = createServices(x.db, { github: github.reach })
    service = services.projectRepositories
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
    dave = await seedAccount(x.db, { username: 'dave' })
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
  const entriesFor = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)
  const repositoryIds = async (caller: Seeded, projectId: string) =>
    (await service.listProjectRepositories(by(caller), projectId)).map((r) => r.id)

  describe('requestRepository', () => {
    it('makes a waiting request when the project admin is not an admin of the repository', async () => {
      const repo = await repositoryOf(bob)
      const projectId = await project()
      const request = await service.requestRepository(by(alice), projectId, repo.id)
      expect(request).toEqual({
        id: expect.any(String),
        project: { id: projectId, name: expect.stringMatching(/^Project-/) },
        repository: { id: repo.id, githubId: repo.githubId, owner: repo.owner, name: repo.name },
        state: 'requested',
        requestedBy: { accountId: alice.id, username: 'alice' },
        requestedAt: expect.any(Date),
        decidedBy: null,
        decidedAt: null,
        withdrawnBy: null,
        withdrawnAt: null,
      })
      expect(await repositoryIds(alice, projectId)).toEqual([])
      expect(await service.pulls(projectId, repo.id)).toBe(false)
      expect(await entriesFor(request.id)).toMatchObject([
        {
          action: 'project-repository.requested',
          actorAccountId: alice.id,
          channels: ['ui'],
          projectId,
          subjectType: 'project-repository-request',
          details: { repositoryId: repo.id, repository: `${repo.owner}/${repo.name}` },
        },
      ])
    })

    it('adds the repository at once when the caller is admin of both (FR-170)', async () => {
      const repo = await repositoryOf(alice)
      const projectId = await project()
      const request = await service.requestRepository(by(alice), projectId, repo.id)
      expect(request).toMatchObject({
        state: 'approved',
        decidedBy: { accountId: alice.id, username: 'alice' },
        decidedAt: expect.any(Date),
      })
      expect(await repositoryIds(alice, projectId)).toEqual([repo.id])
      expect(await service.pulls(projectId, repo.id)).toBe(true)
      expect(await service.listAdminRequests(by(alice), 'requested')).not.toContainEqual(
        expect.objectContaining({ id: request.id }),
      )
      expect(await entriesFor(request.id)).toMatchObject([
        { action: 'project-repository.added', actorAccountId: alice.id, projectId },
      ])
    })

    it('counts an admin role held through a group', async () => {
      const repo = await repositoryOf(dave)
      const projectId = await project()
      const [group] = await x.db
        .insert(groups)
        .values({ name: `Group-${++n}`, createdBy: alice.id })
        .returning({ id: groups.id })
      if (!group) throw new Error('no group')
      await x.db
        .insert(groupMembers)
        .values({ groupId: group.id, accountId: dave.id, role: 'admin' })
      await x.db.insert(groupProjects).values({ groupId: group.id, projectId })
      const request = await service.requestRepository(by(dave), projectId, repo.id)
      expect(request.state).toBe('approved')
    })

    it('refuses a project member who is not its admin, and records nothing', async () => {
      const repo = await repositoryOf(bob)
      const projectId = await project()
      await grantRole(x.db, carol, projectId, 'read-write')
      const error = await refused(
        service.requestRepository(by(carol), projectId, repo.id),
        'forbidden',
      )
      expect(error.message).toMatch(/project's admins/)
      expect(
        await x.db
          .select()
          .from(projectRepositoryRequests)
          .where(eq(projectRepositoryRequests.projectId, projectId)),
      ).toEqual([])
    })

    it('refuses a repository admin with no role in the project as not visible', async () => {
      const repo = await repositoryOf(bob)
      const projectId = await project()
      const error = await refused(
        service.requestRepository(by(bob), projectId, repo.id),
        'not-visible',
      )
      expect(error.message).toBe('This project is not visible to you')
    })

    it('answers a project that does not exist, or a malformed id, as not visible', async () => {
      const repo = await repositoryOf(alice)
      await refused(service.requestRepository(by(alice), NO_SUCH_ID, repo.id), 'not-visible')
      await refused(service.requestRepository(by(alice), 'apollo', repo.id), 'not-visible')
      expect(
        await x.db
          .select()
          .from(projectRepositoryRequests)
          .where(eq(projectRepositoryRequests.repositoryId, repo.id)),
      ).toEqual([])
    })

    it('refuses a repository that is not registered (FR-168)', async () => {
      const projectId = await project()
      const error = await refused(
        service.requestRepository(by(alice), projectId, NO_SUCH_ID),
        'not-found',
      )
      expect(error.message).toMatch(/register it/)
      await refused(service.requestRepository(by(alice), projectId, 'octo/repo'), 'not-found')
    })

    it('refuses a second request while one waits, and one for a repository already added', async () => {
      const waiting = await repositoryOf(bob)
      const added = await repositoryOf(alice)
      const projectId = await project()
      await service.requestRepository(by(alice), projectId, waiting.id)
      await service.requestRepository(by(alice), projectId, added.id)
      const again = await refused(
        service.requestRepository(by(alice), projectId, waiting.id),
        'conflict',
      )
      expect(again.message).toMatch(/already asked/)
      const twice = await refused(
        service.requestRepository(by(alice), projectId, added.id),
        'conflict',
      )
      expect(twice.message).toMatch(/already pulls issues/)
    })

    it('lets only one of two requests made at once succeed', async () => {
      const repo = await repositoryOf(bob)
      const projectId = await project()
      const results = await Promise.allSettled([
        service.requestRepository(by(alice), projectId, repo.id),
        service.requestRepository(by(alice), projectId, repo.id),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const [failure] = results.filter((r) => r.status === 'rejected')
      expect(failure?.reason).toEqual(expect.objectContaining({ kind: 'conflict' }))
      expect(failure?.reason).toBeInstanceOf(ServiceError)
    })

    it('lets the project ask again once a request was rejected or an approval withdrawn', async () => {
      const repo = await repositoryOf(bob)
      const projectId = await project()
      const first = await service.requestRepository(by(alice), projectId, repo.id)
      await service.rejectRequest(by(bob), first.id)
      const second = await service.requestRepository(by(alice), projectId, repo.id)
      expect(second.id).not.toBe(first.id)
      await service.approveRequest(by(bob), second.id)
      await service.withdrawApproval(by(bob), second.id)
      const third = await service.requestRepository(by(alice), projectId, repo.id)
      expect(third.state).toBe('requested')
      expect((await service.listProjectRequests(by(alice), projectId)).map((r) => r.state)).toEqual(
        ['requested', 'withdrawn', 'rejected'],
      )
    })

    it('does not register a repository or change its admins', async () => {
      const repo = await repositoryOf(bob)
      const projectId = await project()
      await service.requestRepository(by(alice), projectId, repo.id)
      expect(
        await x.db
          .select({ accountId: repositoryAdmins.accountId })
          .from(repositoryAdmins)
          .where(eq(repositoryAdmins.repositoryId, repo.id)),
      ).toEqual([{ accountId: bob.id }])
    })
  })

  describe('approveRequest, rejectRequest and withdrawApproval', () => {
    async function waiting() {
      const repo = await repositoryOf(bob)
      await services.repositories.addAdmin(by(bob), repo.id, carol.id)
      const projectId = await project()
      const request = await service.requestRepository(by(alice), projectId, repo.id)
      return { repo, projectId, request }
    }

    it('lets any one of the repository’s admins approve, and the project then pulls from it', async () => {
      const { repo, projectId, request } = await waiting()
      const approved = await service.approveRequest(by(carol), request.id)
      expect(approved).toMatchObject({
        id: request.id,
        state: 'approved',
        decidedBy: { accountId: carol.id, username: 'carol' },
        decidedAt: expect.any(Date),
        withdrawnBy: null,
      })
      expect(await repositoryIds(alice, projectId)).toEqual([repo.id])
      expect(await service.pulls(projectId, repo.id)).toBe(true)
      expect((await entriesFor(request.id)).map((e) => [e.action, e.actorAccountId])).toEqual([
        ['project-repository.requested', alice.id],
        ['project-repository.approved', carol.id],
      ])
    })

    it('lets an admin reject; the repository stays out and the request cannot be approved', async () => {
      const { repo, projectId, request } = await waiting()
      const rejected = await service.rejectRequest(by(bob), request.id)
      expect(rejected).toMatchObject({ state: 'rejected', decidedBy: { username: 'bob' } })
      expect(await repositoryIds(alice, projectId)).toEqual([])
      const error = await refused(service.approveRequest(by(carol), request.id), 'conflict')
      expect(error.message).toMatch(/still waiting/)
      await refused(service.rejectRequest(by(carol), request.id), 'conflict')
      await refused(service.withdrawApproval(by(carol), request.id), 'conflict')
      expect(await service.pulls(projectId, repo.id)).toBe(false)
      expect((await entriesFor(request.id)).at(-1)).toMatchObject({
        action: 'project-repository.rejected',
        actorAccountId: bob.id,
        projectId,
      })
    })

    it('lets an admin withdraw an approval; the project stops pulling and keeps its tasks', async () => {
      const { repo, projectId, request } = await waiting()
      await service.approveRequest(by(bob), request.id)
      const task = await services.tasks.createTask(by(alice), projectId, { title: 'Old' })
      const withdrawn = await service.withdrawApproval(by(carol), request.id)
      expect(withdrawn).toMatchObject({
        state: 'withdrawn',
        decidedBy: { username: 'bob' },
        withdrawnBy: { accountId: carol.id, username: 'carol' },
        withdrawnAt: expect.any(Date),
      })
      expect(await repositoryIds(alice, projectId)).toEqual([])
      expect(await service.pulls(projectId, repo.id)).toBe(false)
      expect(await x.db.select().from(tasks).where(eq(tasks.id, task.id))).toMatchObject([
        { projectId, title: 'Old', status: 'not-started' },
      ])
      await refused(service.withdrawApproval(by(bob), request.id), 'conflict')
      await refused(service.approveRequest(by(bob), request.id), 'conflict')
      expect((await entriesFor(request.id)).at(-1)).toMatchObject({
        action: 'project-repository.withdrawn',
        actorAccountId: carol.id,
      })
    })

    it('refuses a waiting request’s withdrawal: only an approval can be withdrawn', async () => {
      const { request } = await waiting()
      const error = await refused(service.withdrawApproval(by(bob), request.id), 'conflict')
      expect(error.message).toMatch(/approval in force/)
    })

    it('refuses everyone who is not the repository’s admin, system admins and the requester included', async () => {
      const { request } = await waiting()
      for (const who of [alice, root, dave]) {
        await refused(service.approveRequest(by(who), request.id), 'forbidden')
        await refused(service.rejectRequest(by(who), request.id), 'forbidden')
      }
      await service.approveRequest(by(bob), request.id)
      await refused(service.withdrawApproval(by(alice), request.id), 'forbidden')
      await refused(service.withdrawApproval(by(root), request.id), 'forbidden')
      await refused(
        service.withdrawApproval({ accountId: 'nobody', channel: 'ui' }, request.id),
        'forbidden',
      )
      // Nothing the refused callers asked for was recorded.
      expect((await entriesFor(request.id)).map((e) => e.actorAccountId)).toEqual([
        alice.id,
        bob.id,
      ])
      expect(await service.pulls(request.project.id, request.repository.id)).toBe(true)
    })

    it('refuses an admin removed since, and answers a request that does not exist as not found', async () => {
      const { repo, request } = await waiting()
      await services.repositories.removeAdmin(by(bob), repo.id, carol.id)
      await refused(service.approveRequest(by(carol), request.id), 'forbidden')
      await refused(service.approveRequest(by(bob), NO_SUCH_ID), 'not-found')
      await refused(service.rejectRequest(by(bob), 'request-1'), 'not-found')
      const [row] = await x.db
        .select({ state: projectRepositoryRequests.state })
        .from(projectRepositoryRequests)
        .where(eq(projectRepositoryRequests.id, request.id))
      expect(row?.state).toBe('requested')
    })

    it('lets only one of two decisions made at once on a request succeed', async () => {
      const { request } = await waiting()
      const results = await Promise.allSettled([
        service.approveRequest(by(bob), request.id),
        service.rejectRequest(by(carol), request.id),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const [state] = await x.db
        .select({ state: projectRepositoryRequests.state })
        .from(projectRepositoryRequests)
        .where(eq(projectRepositoryRequests.id, request.id))
      expect(['approved', 'rejected']).toContain(state?.state)
    })

    it('records the channel the decision came through', async () => {
      const { request } = await waiting()
      await service.approveRequest({ accountId: bob.id, channel: 'mcp' }, request.id)
      expect((await entriesFor(request.id)).at(-1)?.channels).toEqual(['mcp'])
    })
  })

  describe('reading', () => {
    it('shows a project’s repositories and requests to every role in it, and to no one else', async () => {
      const repo = await repositoryOf(alice)
      const projectId = await project()
      await service.requestRepository(by(alice), projectId, repo.id)
      await grantRole(x.db, carol, projectId, 'read-only')
      expect(await repositoryIds(carol, projectId)).toEqual([repo.id])
      expect(await service.listProjectRequests(by(carol), projectId)).toHaveLength(1)
      await refused(service.listProjectRepositories(by(dave), projectId), 'not-visible')
      await refused(service.listProjectRequests(by(dave), projectId), 'not-visible')
    })

    it('lists a project’s repositories by owner and name', async () => {
      const projectId = await project()
      const added: ProjectRepository[] = []
      for (const fullName of ['zeta/b', 'alpha/b', 'alpha/a']) {
        const created = github.createRepository(`${fullName}-${++n}`)
        const repo = await services.repositories.registerRepository(by(alice), created)
        await service.requestRepository(by(alice), projectId, repo.id)
        added.push({ id: repo.id, githubId: repo.githubId, owner: repo.owner, name: repo.name })
      }
      expect(await service.listProjectRepositories(by(alice), projectId)).toEqual([
        added[2],
        added[1],
        added[0],
      ])
    })

    it('shows a repository admin the requests for their repositories only, by state when asked', async () => {
      const erin = await seedAccount(x.db, { username: 'erin' })
      const mine = await repositoryOf(erin)
      const other = await repositoryOf(bob)
      const projectId = await project()
      const first = await service.requestRepository(by(alice), projectId, mine.id)
      await service.requestRepository(by(alice), projectId, other.id)
      await service.rejectRequest(by(erin), first.id)
      const second = await service.requestRepository(by(alice), projectId, mine.id)

      const all = await service.listAdminRequests(by(erin))
      expect(all.map((r) => r.id)).toEqual([second.id, first.id])
      expect((await service.listAdminRequests(by(erin), 'requested')).map((r) => r.id)).toEqual([
        second.id,
      ])
      expect((await service.listAdminRequests(by(erin), 'rejected')).map((r) => r.id)).toEqual([
        first.id,
      ])
      // erin holds no role in the project, but sees its name to decide on its request.
      expect(all[0]?.project).toEqual({ id: projectId, name: expect.stringMatching(/^Project-/) })
      expect(await service.listAdminRequests({ accountId: 'nobody', channel: 'ui' })).toEqual([])
      await refused(service.listAdminRequests(by(erin), 'pending'), 'invalid')
    })
  })

  describe('pulls', () => {
    it('answers false for ids that are not ids, and true only while an approval is in force', async () => {
      const repo = await repositoryOf(alice)
      const projectId = await project()
      expect(await service.pulls('apollo', repo.id)).toBe(false)
      expect(await service.pulls(projectId, 'repo')).toBe(false)
      expect(await service.pulls(projectId, repo.id)).toBe(false)
      await service.requestRepository(by(alice), projectId, repo.id)
      expect(await service.pulls(projectId, repo.id, { executor: x.db })).toBe(true)
    })

    it('with lock, makes a withdrawal wait until the transaction that asked ends', async () => {
      const repo = await repositoryOf(alice)
      const projectId = await project()
      const request = await service.requestRepository(by(alice), projectId, repo.id)
      const order: string[] = []
      let release = () => {}
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let asked = () => {}
      const askedYet = new Promise<void>((resolve) => {
        asked = resolve
      })
      const importing = x.db.transaction(async (tx) => {
        expect(await service.pulls(projectId, repo.id, { executor: tx, lock: true })).toBe(true)
        asked()
        await held
        order.push('import')
      })
      await askedYet
      const withdrawing = service.withdrawApproval(by(alice), request.id).then(() => {
        order.push('withdraw')
      })
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(order).toEqual([])
      release()
      await Promise.all([importing, withdrawing])
      expect(order).toEqual(['import', 'withdraw'])
      expect(await service.pulls(projectId, repo.id)).toBe(false)
    })
  })
})

describe('test cases through the REST API', () => {
  // Each test case starts from its own fresh test deployment, as the test cases ask.
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let github: FakeGitHub
  let services: Services
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    services = createServices(x.db, { github: github.reach })
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
  async function registeredBy(registrant: Seeded, fullName = 'csillagu/tc-repo'): Promise<string> {
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
  const ask = (account: Seeded, projectId: string, repositoryId: string) =>
    app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/repository-requests`,
      headers: as(account),
      payload: { repositoryId },
    })
  const decide = (account: Seeded, requestId: string, decision: string) =>
    app.inject({
      method: 'POST',
      url: `/api/repository-requests/${requestId}/${decision}`,
      headers: as(account),
    })
  const repositoriesOf = async (account: Seeded, projectId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/repositories`,
      headers: as(account),
    })
    expect(response.statusCode).toBe(200)
    return response.json<ProjectRepository[]>().map((r) => `${r.owner}/${r.name}`)
  }
  const requestsOf = async (account: Seeded, projectId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/repository-requests`,
      headers: as(account),
    })
    expect(response.statusCode).toBe(200)
    return response.json<RepositoryRequest[]>()
  }
  const pendingApprovalsOf = async (account: Seeded) => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/repository-requests?state=requested',
      headers: as(account),
    })
    expect(response.statusCode).toBe(200)
    return response.json<RepositoryRequest[]>()
  }
  const tasksOf = async (account: Seeded, projectId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/tasks`,
      headers: as(account),
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ id: string; title: string; status: string }[]>()
  }
  const createTask = async (account: Seeded, projectId: string, title: string) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tasks`,
      headers: as(account),
      payload: { title },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string; title: string }>()
  }

  describe('TC-210: a project admin adds a repository the project pulls issues from, once approved', () => {
    it('adds tc-repo to Apollo only once bob approves, and gives bob no role in Apollo', async () => {
      const repoId = await registeredBy(bob)
      const apollo = await seedProject(x.db, alice, 'Apollo')

      // Step 1: as alice, set tc-repo as a repository Apollo pulls issues from.
      const asked = await ask(alice, apollo, repoId)
      expect(asked.statusCode).toBe(201)
      expect(asked.json()).toMatchObject({ state: 'requested' })
      expect(await repositoriesOf(alice, apollo)).toEqual([])

      // Step 2: as bob, approve the request.
      const approved = await decide(bob, asked.json<RepositoryRequest>().id, 'approve')
      expect(approved.statusCode).toBe(200)
      expect(await repositoriesOf(alice, apollo)).toEqual(['csillagu/tc-repo'])

      // Negative: bob gains no role in Apollo.
      expect(
        await x.db.select().from(projectMembers).where(eq(projectMembers.accountId, bob.id)),
      ).toEqual([])
      expect(await services.projectRoles.roleOf(bob.id, apollo)).toBeUndefined()
    })
  })

  describe("TC-245: one repository admin's approval adds the repository to a project", () => {
    it('adds tc-repo once carol approves, without bob', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      const repoId = await registeredBy(bob)
      const added = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repoId}/admins`,
        headers: as(bob),
        payload: { accountId: carol.id },
      })
      expect(added.statusCode).toBe(200)
      const apollo = await seedProject(x.db, alice, 'Apollo')

      // Step 1: as alice, ask to add tc-repo to Apollo to pull its issues.
      const asked = await ask(alice, apollo, repoId)
      expect(asked.statusCode).toBe(201)
      expect(await repositoriesOf(alice, apollo)).toEqual([])
      // Negative: Apollo gets no task from tc-repo before step 2.
      expect(await tasksOf(alice, apollo)).toEqual([])

      // Step 2: as carol, approve the request.
      const approved = await decide(carol, asked.json<RepositoryRequest>().id, 'approve')
      expect(approved.statusCode).toBe(200)
      expect(approved.json()).toMatchObject({ decidedBy: { username: 'carol' } })
      expect(await repositoriesOf(alice, apollo)).toEqual(['csillagu/tc-repo'])
    })
  })

  describe("TC-246: seeding from a repository waits for a repository admin's approval", () => {
    it('adds tc-seed to Apollo for seeding only once bob approves', async () => {
      // tc-seed's open issue #1 and the seeding run itself are the seeding importer's (SC-025),
      // not built yet: this checks what SC-110 decides, that the repository is added to Apollo,
      // for seeding as for pulling, only after bob's approval.
      const repoId = await registeredBy(bob, 'csillagu/tc-seed')
      const apollo = await seedProject(x.db, alice, 'Apollo')

      // Step 1: as alice, ask to seed Apollo from tc-seed.
      const asked = await ask(alice, apollo, repoId)
      expect(asked.statusCode).toBe(201)
      expect(await tasksOf(alice, apollo)).toEqual([])
      expect(await services.projectRepositories.pulls(apollo, repoId)).toBe(false)

      // Step 2: as bob, approve.
      expect((await decide(bob, asked.json<RepositoryRequest>().id, 'approve')).statusCode).toBe(
        200,
      )
      expect(await repositoriesOf(alice, apollo)).toEqual(['csillagu/tc-seed'])
      expect(await services.projectRepositories.pulls(apollo, repoId)).toBe(true)
    })
  })

  describe('TC-247: an unregistered repository cannot be added to a project', () => {
    it('rejects tc-repo, which has no id in the tool, and does not register it', async () => {
      github.createRepository('csillagu/tc-repo')
      const apollo = await seedProject(x.db, alice, 'Apollo')

      // tc-repo is not offered: the registry, from which a repository is chosen, does not have it.
      const offered = await app.inject({
        method: 'GET',
        url: '/api/repositories',
        headers: as(alice),
      })
      expect(offered.json()).toEqual([])

      // Step 1: as alice, try to add tc-repo to Apollo, with an id the registry never gave out.
      const attempt = await ask(alice, apollo, NO_SUCH_ID)
      expect(attempt.statusCode).toBe(404)

      // Step 2: read Apollo's repositories.
      expect(await repositoriesOf(alice, apollo)).toEqual([])
      // Negative: tc-repo is not registered as a side effect.
      expect(await x.db.select().from(repositories)).toEqual([])
      expect(await x.db.select().from(projectRepositoryRequests)).toEqual([])
    })
  })

  describe('TC-249: an admin of both the repository and the project adds it without approval', () => {
    it('adds tc-repo to Apollo at once, with no approval pending', async () => {
      const repoId = await registeredBy(alice)
      const apollo = await seedProject(x.db, alice, 'Apollo')

      // Step 1: as alice, add tc-repo to Apollo to pull its issues.
      const added = await ask(alice, apollo, repoId)
      expect(added.statusCode).toBe(201)
      expect(added.json()).toMatchObject({ state: 'approved', decidedBy: { username: 'alice' } })

      // Step 2: read Apollo's repositories and alice's pending approvals.
      expect(await repositoriesOf(alice, apollo)).toEqual(['csillagu/tc-repo'])
      // Negative: no approval request is pending for it. (No repository-request notification is
      // sent: the notifications (SC-012) are not built yet, so there is none to check.)
      expect(await pendingApprovalsOf(alice)).toEqual([])
      expect((await requestsOf(alice, apollo)).map((r) => r.state)).toEqual(['approved'])
    })
  })

  describe("TC-250: a repository admin rejects a project's request", () => {
    it('rejects the request; tc-repo stays out of Apollo and cannot be approved', async () => {
      const repoId = await registeredBy(bob)
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const asked = await ask(alice, apollo, repoId)
      const requestId = asked.json<RepositoryRequest>().id

      // Step 1: as bob, reject the request.
      const rejected = await decide(bob, requestId, 'reject')
      expect(rejected.statusCode).toBe(200)

      // Step 2: read Apollo's repositories and the request's state.
      expect(rejected.json()).toMatchObject({ id: requestId, state: 'rejected' })
      expect(await requestsOf(alice, apollo)).toMatchObject([{ id: requestId, state: 'rejected' }])
      // Negative: tc-repo is not among Apollo's repositories, and the request can no longer be
      // approved.
      expect(await repositoriesOf(alice, apollo)).toEqual([])
      const approval = await decide(bob, requestId, 'approve')
      expect(approval.statusCode).toBe(409)
      expect(await repositoriesOf(alice, apollo)).toEqual([])
    })
  })

  describe('TC-251: withdrawing an approval stops the project pulling and keeps its tasks', () => {
    it('takes tc-repo out of Apollo’s repositories and keeps Old', async () => {
      // Assigning a task to a repository (SC-036) and its GitHub issue (SC-022) are not built yet:
      // Old is a task of Apollo without them, and whether `New` can be assigned to tc-repo is
      // checked as what SC-036 will ask, whether Apollo still pulls from it.
      const repoId = await registeredBy(bob)
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const asked = await ask(alice, apollo, repoId)
      const requestId = asked.json<RepositoryRequest>().id
      expect((await decide(bob, requestId, 'approve')).statusCode).toBe(200)
      const old = await createTask(alice, apollo, 'Old')
      await createTask(alice, apollo, 'New')

      // Step 1: as bob, withdraw the approval for Apollo.
      const withdrawn = await decide(bob, requestId, 'withdraw')
      expect(withdrawn.statusCode).toBe(200)
      expect(withdrawn.json()).toMatchObject({ state: 'withdrawn' })

      // Step 2: read Apollo's repositories; New can no longer be assigned to tc-repo.
      expect(await repositoriesOf(alice, apollo)).toEqual([])
      expect(await services.projectRepositories.pulls(apollo, repoId)).toBe(false)

      // Step 3: list Apollo's tasks. Old is still there, neither deleted nor cancelled.
      const listed = await tasksOf(alice, apollo)
      expect(listed.map((t) => t.title).toSorted()).toEqual(['New', 'Old'])
      expect(listed.find((t) => t.id === old.id)).toMatchObject({ status: 'not-started' })
    })
  })

  describe('TC-252: a receiving project whose approval is withdrawn stops receiving new issues', () => {
    it('stops Apollo pulling from tc-repo and removes none of its tasks', async () => {
      // Marking Apollo as tc-repo's receiving project (SC-111) and receiving a new issue from
      // GitHub (SC-023) are not built yet: this checks that the withdrawal is recorded so that
      // Apollo no longer pulls from tc-repo, which is what the inbound handler will ask.
      const repoId = await registeredBy(bob)
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const asked = await ask(alice, apollo, repoId)
      const requestId = asked.json<RepositoryRequest>().id
      expect((await decide(bob, requestId, 'approve')).statusCode).toBe(200)
      await createTask(alice, apollo, 'Earlier')

      // Step 1: as bob, withdraw the approval for Apollo.
      expect((await decide(bob, requestId, 'withdraw')).statusCode).toBe(200)

      // Steps 2 and 3: a new issue would not be added to Apollo, which no longer pulls from tc-repo.
      expect(await services.projectRepositories.pulls(apollo, repoId)).toBe(false)
      // Negative: no earlier task of Apollo is removed.
      expect((await tasksOf(alice, apollo)).map((t) => t.title)).toEqual(['Earlier'])
    })
  })

  describe('the routes, end to end', () => {
    it('refuses a non-admin of the project with 403, and a caller with no role with 403 Not Visible', async () => {
      const carol = await seedAccount(x.db, { username: 'carol' })
      const repoId = await registeredBy(bob)
      const apollo = await seedProject(x.db, alice, 'Apollo')
      await grantRole(x.db, carol, apollo, 'read-write')
      expect((await ask(carol, apollo, repoId)).statusCode).toBe(403)
      const hidden = await ask(bob, apollo, repoId)
      expect(hidden.statusCode).toBe(403)
      expect(hidden.json()).toMatchObject({ error: 'Not Visible' })
    })

    it('refuses a decision by someone who is not the repository’s admin with 403', async () => {
      const repoId = await registeredBy(bob)
      const apollo = await seedProject(x.db, alice, 'Apollo')
      const requestId = (await ask(alice, apollo, repoId)).json<RepositoryRequest>().id
      expect((await decide(alice, requestId, 'approve')).statusCode).toBe(403)
      expect((await decide(alice, requestId, 'reject')).statusCode).toBe(403)
      expect((await decide(bob, requestId, 'withdraw')).statusCode).toBe(409)
    })
  })
})
