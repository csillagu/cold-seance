import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  auditLog,
  groupMembers,
  groupProjects,
  groups,
  repositoryReceivingProjects,
} from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type {
  ProjectRepositoryService,
  RepositoryRequest,
} from '../../src/service/project-repositories.ts'
import {
  ALREADY_RECEIVING_MESSAGE,
  NOT_PULLING_MESSAGE,
  NOT_RECEIVING_MESSAGE,
  type ReceivingProjectService,
  type ReceivingRepository,
} from '../../src/service/receiving-projects.ts'
import type { RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The receiving project register (SC-111) against a real PostgreSQL: its rules through the
// service, then the test cases of FR-143 through the REST API, with repositories registered
// through the registry (SC-019) against a fake GitHub and added to projects through the project
// repository approvals (SC-110).

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

describe('the receiving project service', () => {
  let x: TestDatabase
  let github: FakeGitHub
  let services: Services
  let service: ReceivingProjectService
  let approvals: ProjectRepositoryService
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
    service = services.receivingProjects
    approvals = services.projectRepositories
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
    dave = await seedAccount(x.db, { username: 'dave' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  /** A repository registered by alice, under a name no other test uses. */
  async function repository(): Promise<RegisteredRepository> {
    const repo = github.createRepository(`Octo-${++n}/Repo-${n}`)
    return services.repositories.registerRepository(by(alice), repo)
  }
  /** A project created by `admin`, its only admin, under a name no other test uses. */
  const project = (admin: Seeded = alice) => seedProject(x.db, admin, `Project-${++n}`)
  /** A project of `admin`'s that pulls issues from the repository, approved by alice. */
  async function pulling(repo: RegisteredRepository, admin: Seeded = alice): Promise<string> {
    const projectId = await project(admin)
    const request = await approvals.requestRepository(by(admin), projectId, repo.id)
    if (request.state === 'requested') await approvals.approveRequest(by(alice), request.id)
    return projectId
  }
  const entriesFor = (repositoryId: string) =>
    x.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.subjectId, repositoryId))
      .orderBy(auditLog.id)
      .then((rows) => rows.filter((row) => row.action.startsWith('repository.receiving')))
  const receivingOf = (repositoryId: string) => service.receivingProjectOf(repositoryId)

  describe('markReceiving (FR-143)', () => {
    it("marks a pulling project as the repository's receiving project, and records it", async () => {
      const repo = await repository()
      const apollo = await pulling(repo, bob)
      const marked = await service.markReceiving(by(bob), apollo, repo.id)
      expect(marked).toEqual({
        repository: { id: repo.id, githubId: repo.githubId, owner: repo.owner, name: repo.name },
        pulls: true,
      })
      expect(await receivingOf(repo.id)).toBe(apollo)
      expect(await entriesFor(repo.id)).toMatchObject([
        {
          action: 'repository.receiving-marked',
          actorAccountId: bob.id,
          channels: ['ui'],
          projectId: apollo,
          subjectType: 'repository',
          details: { repository: `${repo.owner}/${repo.name}` },
        },
      ])
    })

    it('changes nothing when the project already is the receiving one', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const first = await service.markReceiving(by(alice), apollo, repo.id)
      await grantRole(x.db, carol, apollo, 'admin')
      const again = await service.markReceiving(by(carol), apollo, repo.id)
      expect(again).toEqual(first)
      expect(await entriesFor(repo.id)).toHaveLength(1)
    })

    it('accepts the ids in upper case', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      await service.markReceiving(by(alice), apollo.toUpperCase(), repo.id.toUpperCase())
      expect(await receivingOf(repo.id)).toBe(apollo)
      await service.markReceiving(by(alice), apollo.toUpperCase(), repo.id.toUpperCase())
      expect(await entriesFor(repo.id)).toHaveLength(1)
    })

    it('counts a project admin role held through a group (FR-111)', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const [group] = await x.db
        .insert(groups)
        .values({ name: `Group-${++n}`, createdBy: alice.id })
        .returning({ id: groups.id })
      if (!group) throw new Error('no group')
      await x.db
        .insert(groupMembers)
        .values({ groupId: group.id, accountId: dave.id, role: 'admin' })
      await x.db.insert(groupProjects).values({ groupId: group.id, projectId: apollo })
      await service.markReceiving(by(dave), apollo, repo.id)
      expect(await receivingOf(repo.id)).toBe(apollo)
    })

    it('refuses a project that has only asked for the repository, or never asked for it', async () => {
      const repo = await repository()
      const asked = await project(bob)
      await approvals.requestRepository(by(bob), asked, repo.id)
      const never = await project(bob)
      for (const projectId of [asked, never]) {
        const error = await refused(service.markReceiving(by(bob), projectId, repo.id), 'invalid')
        expect(error.message).toBe(NOT_PULLING_MESSAGE)
      }
      expect(await receivingOf(repo.id)).toBeNull()
    })

    it('refuses a project whose approval was withdrawn', async () => {
      const repo = await repository()
      const apollo = await project(bob)
      const request = await approvals.requestRepository(by(bob), apollo, repo.id)
      await approvals.approveRequest(by(alice), request.id)
      await approvals.withdrawApproval(by(alice), request.id)
      await refused(service.markReceiving(by(bob), apollo, repo.id), 'invalid')
      expect(await receivingOf(repo.id)).toBeNull()
    })

    it('refuses a repository that is not registered, or an id that is not one', async () => {
      const apollo = await project()
      await refused(service.markReceiving(by(alice), apollo, NO_SUCH_ID), 'invalid')
      const error = await refused(service.markReceiving(by(alice), apollo, 'octo/repo'), 'invalid')
      expect(error.message).toBe(NOT_PULLING_MESSAGE)
    })

    it("refuses a member who is not the project's admin, and records nothing", async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      for (const role of ['read-write', 'contributor', 'read-only'] as const) {
        await grantRole(x.db, carol, apollo, role)
        await refused(service.markReceiving(by(carol), apollo, repo.id), 'forbidden')
      }
      expect(await receivingOf(repo.id)).toBeNull()
      expect(await entriesFor(repo.id)).toEqual([])
    })

    it('refuses as not visible someone with no role, and a project that does not exist', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      await refused(service.markReceiving(by(dave), apollo, repo.id), 'not-visible')
      await refused(service.markReceiving(by(alice), NO_SUCH_ID, repo.id), 'not-visible')
      await refused(service.markReceiving(by(alice), 'apollo', repo.id), 'not-visible')
      expect(await receivingOf(repo.id)).toBeNull()
    })
  })

  describe('a second receiving project (FR-179)', () => {
    it('is refused while one is marked, and the current one stays', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const borealis = await pulling(repo, bob)
      await service.markReceiving(by(alice), apollo, repo.id)
      const error = await refused(service.markReceiving(by(bob), borealis, repo.id), 'conflict')
      expect(error.message).toBe(ALREADY_RECEIVING_MESSAGE)
      expect(await receivingOf(repo.id)).toBe(apollo)
      expect(await entriesFor(repo.id)).toHaveLength(1)
    })

    it('is refused even when its admin is also the receiving project’s admin', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const borealis = await pulling(repo)
      await service.markReceiving(by(alice), apollo, repo.id)
      await refused(service.markReceiving(by(alice), borealis, repo.id), 'conflict')
      expect(await receivingOf(repo.id)).toBe(apollo)
    })

    it('is refused while the receiving project no longer pulls, until it gives the role up', async () => {
      const repo = await repository()
      const apollo = await project(bob)
      const request = await approvals.requestRepository(by(bob), apollo, repo.id)
      await approvals.approveRequest(by(alice), request.id)
      await service.markReceiving(by(bob), apollo, repo.id)
      await approvals.withdrawApproval(by(alice), request.id)
      const borealis = await pulling(repo)

      // Apollo keeps the role, so no project receives the repository's new issues (SRC-215).
      await refused(service.markReceiving(by(alice), borealis, repo.id), 'conflict')
      expect(await receivingOf(repo.id)).toBe(apollo)
      expect(await service.listReceiving(by(bob), apollo)).toMatchObject([{ pulls: false }])

      await service.giveUpReceiving(by(bob), apollo, repo.id)
      await service.markReceiving(by(alice), borealis, repo.id)
      expect(await receivingOf(repo.id)).toBe(borealis)
    })

    it('lets exactly one of two projects marked at once be the receiving one', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const borealis = await pulling(repo, bob)
      const results = await Promise.allSettled([
        service.markReceiving(by(alice), apollo, repo.id),
        service.markReceiving(by(bob), borealis, repo.id),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const reasons = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      expect(reasons).toEqual([expect.objectContaining({ kind: 'conflict' })])
      expect(reasons[0]).toBeInstanceOf(ServiceError)
      expect([apollo, borealis]).toContain(await receivingOf(repo.id))
      expect(await entriesFor(repo.id)).toHaveLength(1)
    })

    it('makes a marking wait for one not yet committed, then refuses it', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const borealis = await pulling(repo, bob)
      let release: () => void = () => undefined
      const hold = new Promise<void>((resolve) => (release = resolve))
      let inserted = false
      // Apollo's marking, held open after its row is written.
      const holding = x.db.transaction(async (tx) => {
        await tx
          .insert(repositoryReceivingProjects)
          .values({ repositoryId: repo.id, projectId: apollo })
        inserted = true
        await hold
      })
      await expect.poll(() => inserted).toBe(true)
      let settled = false
      const second = service
        .markReceiving(by(bob), borealis, repo.id)
        .finally(() => (settled = true))
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(settled).toBe(false)
      release()
      await holding
      const error = await refused(second, 'conflict')
      expect(error.message).toBe(ALREADY_RECEIVING_MESSAGE)
      expect(await receivingOf(repo.id)).toBe(apollo)
    })

    it('marks a project whose rival marking waited on is given up before it is read', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const borealis = await pulling(repo, bob)
      let release: () => void = () => undefined
      const hold = new Promise<void>((resolve) => (release = resolve))
      let inserted = false
      // A rival marking that is rolled back: the waiting one then finds the repository free.
      const holding = x.db
        .transaction(async (tx) => {
          await tx
            .insert(repositoryReceivingProjects)
            .values({ repositoryId: repo.id, projectId: apollo })
          inserted = true
          await hold
          tx.rollback()
        })
        .catch(() => undefined)
      await expect.poll(() => inserted).toBe(true)
      const second = service.markReceiving(by(bob), borealis, repo.id)
      await new Promise((resolve) => setTimeout(resolve, 200))
      release()
      await holding
      await expect(second).resolves.toMatchObject({ repository: { id: repo.id }, pulls: true })
      expect(await receivingOf(repo.id)).toBe(borealis)
    })

    it('lets two admins of the same project mark it at once', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      await grantRole(x.db, carol, apollo, 'admin')
      const results = await Promise.allSettled([
        service.markReceiving(by(alice), apollo, repo.id),
        service.markReceiving(by(carol), apollo, repo.id),
      ])
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
      expect(await receivingOf(repo.id)).toBe(apollo)
      expect(await entriesFor(repo.id)).toHaveLength(1)
    })
  })

  describe('giveUpReceiving (FR-180)', () => {
    it('leaves the repository with no receiving project, and lets another project be marked', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const borealis = await pulling(repo, bob)
      await service.markReceiving(by(alice), apollo, repo.id)

      await service.giveUpReceiving(by(alice), apollo, repo.id)
      expect(await receivingOf(repo.id)).toBeNull()
      expect(await service.listReceiving(by(alice), apollo)).toEqual([])

      await service.markReceiving(by(bob), borealis, repo.id)
      expect(await receivingOf(repo.id)).toBe(borealis)
      expect(
        (await entriesFor(repo.id)).map((e) => [e.action, e.projectId, e.actorAccountId]),
      ).toEqual([
        ['repository.receiving-marked', apollo, alice.id],
        ['repository.receiving-given-up', apollo, alice.id],
        ['repository.receiving-marked', borealis, bob.id],
      ])
    })

    it('accepts the ids in upper case', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      await service.markReceiving(by(alice), apollo, repo.id)
      await service.giveUpReceiving(by(alice), apollo.toUpperCase(), repo.id.toUpperCase())
      expect(await receivingOf(repo.id)).toBeNull()
    })

    it("refuses another project's admin, and the role stays", async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      const borealis = await pulling(repo, bob)
      await service.markReceiving(by(alice), apollo, repo.id)
      const error = await refused(service.giveUpReceiving(by(bob), borealis, repo.id), 'conflict')
      expect(error.message).toBe(NOT_RECEIVING_MESSAGE)
      expect(await receivingOf(repo.id)).toBe(apollo)
    })

    it("refuses anyone but the receiving project's admin, and the role stays", async () => {
      const repo = await repository()
      const apollo = await pulling(repo, bob)
      await service.markReceiving(by(bob), apollo, repo.id)
      for (const role of ['read-write', 'contributor', 'read-only'] as const) {
        await grantRole(x.db, carol, apollo, role)
        await refused(service.giveUpReceiving(by(carol), apollo, repo.id), 'forbidden')
      }
      // alice is the repository's admin and holds no role in Apollo; root is a system admin.
      // Neither is the receiving project's admin (SRC-218).
      await refused(service.giveUpReceiving(by(alice), apollo, repo.id), 'not-visible')
      await refused(service.giveUpReceiving(by(root), apollo, repo.id), 'not-visible')
      await refused(service.giveUpReceiving(by(bob), NO_SUCH_ID, repo.id), 'not-visible')
      expect(await receivingOf(repo.id)).toBe(apollo)
      expect(await entriesFor(repo.id)).toHaveLength(1)
    })

    it('refuses a repository with no receiving project, or an id that is not one', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      await refused(service.giveUpReceiving(by(alice), apollo, repo.id), 'conflict')
      await refused(service.giveUpReceiving(by(alice), apollo, NO_SUCH_ID), 'conflict')
      const error = await refused(
        service.giveUpReceiving(by(alice), apollo, 'octo/repo'),
        'conflict',
      )
      expect(error.message).toBe(NOT_RECEIVING_MESSAGE)
    })
  })

  describe('reading', () => {
    it("lists the project's receiving repositories by owner and name to every role in it", async () => {
      const first = github.createRepository(`Aaa-${++n}/one`)
      const second = github.createRepository(`Aaa-${n}/two`)
      const two = await services.repositories.registerRepository(by(alice), second)
      const one = await services.repositories.registerRepository(by(alice), first)
      const apollo = await project()
      for (const repo of [two, one]) {
        await approvals.requestRepository(by(alice), apollo, repo.id)
        await service.markReceiving(by(alice), apollo, repo.id)
      }
      await grantRole(x.db, carol, apollo, 'read-only')
      const listed = await service.listReceiving(by(carol), apollo)
      expect(listed.map((r) => r.repository.name)).toEqual(['one', 'two'])
      expect(listed.every((r) => r.pulls)).toBe(true)
      await refused(service.listReceiving(by(dave), apollo), 'not-visible')
    })

    it('answers no receiving project for an id that is not one', async () => {
      expect(await service.receivingProjectOf('octo/repo')).toBeNull()
      expect(await service.receivingProjectOf(NO_SUCH_ID)).toBeNull()
    })

    it('reads in a transaction, locking the marking until it ends', async () => {
      const repo = await repository()
      const apollo = await pulling(repo)
      await service.markReceiving(by(alice), apollo, repo.id)
      let released: () => void = () => undefined
      const hold = new Promise<void>((resolve) => (released = resolve))
      let read: string | null = null
      const holding = x.db.transaction(async (tx) => {
        read = await service.receivingProjectOf(repo.id, { executor: tx, lock: true })
        await hold
      })
      // Wait until the lock is taken, then give the role up: it waits for the transaction.
      await expect.poll(() => read).toBe(apollo)
      let given = false
      const giving = service.giveUpReceiving(by(alice), apollo, repo.id).then(() => (given = true))
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(given).toBe(false)
      released()
      await holding
      await giving
      expect(await receivingOf(repo.id)).toBeNull()
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
  /** Adds the repository to the project as one it pulls issues from, approved by `approver`. */
  async function added(asker: Seeded, projectId: string, repositoryId: string, approver: Seeded) {
    const asked = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/repository-requests`,
      headers: as(asker),
      payload: { repositoryId },
    })
    expect(asked.statusCode).toBe(201)
    const request = asked.json<RepositoryRequest>()
    if (request.state === 'requested') await approve(approver, request.id)
    return request.id
  }
  async function approve(approver: Seeded, requestId: string) {
    const approved = await app.inject({
      method: 'POST',
      url: `/api/repository-requests/${requestId}/approve`,
      headers: as(approver),
    })
    expect(approved.statusCode).toBe(200)
  }
  const mark = (account: Seeded, projectId: string, repositoryId: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/receiving-repositories/${repositoryId}`,
      headers: as(account),
    })
  const giveUp = (account: Seeded, projectId: string, repositoryId: string) =>
    app.inject({
      method: 'DELETE',
      url: `/api/projects/${projectId}/receiving-repositories/${repositoryId}`,
      headers: as(account),
    })
  const receivingOf = async (account: Seeded, projectId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/${projectId}/receiving-repositories`,
      headers: as(account),
    })
    expect(response.statusCode).toBe(200)
    return response.json<ReceivingRepository[]>()
  }

  describe("TC-211: a pulling project's admin marks it as the receiving project", () => {
    it('makes Borealis the receiving project for tc-repo, and not Apollo', async () => {
      const repoId = await registeredBy(alice)
      const apollo = await createdBy(alice, 'Apollo')
      const borealis = await createdBy(bob, 'Borealis')
      await added(alice, apollo, repoId, alice)
      await added(bob, borealis, repoId, alice)
      expect(await receivingOf(alice, apollo)).toEqual([])
      expect(await receivingOf(bob, borealis)).toEqual([])

      // Step 1: as bob, mark Borealis as the receiving project for tc-repo.
      const marked = await mark(bob, borealis, repoId)
      expect(marked.statusCode).toBe(200)

      // Step 2: read tc-repo's receiving project. Expected: Borealis.
      expect(await receivingOf(bob, borealis)).toMatchObject([
        { repository: { id: repoId, owner: 'csillagu', name: 'tc-repo' }, pulls: true },
      ])
      // The same, read where the GitHub change handler (SC-023) will read it.
      expect(await services.receivingProjects.receivingProjectOf(repoId)).toBe(borealis)
      // Negative: Apollo is not marked as receiving.
      expect(await receivingOf(alice, apollo)).toEqual([])
    })
  })

  describe('TC-212: a receiving project that stops pulling stops receiving new issues', () => {
    it('precondition only: Apollo keeps the role but no longer pulls from tc-repo (SRC-215)', async () => {
      // This does not verify TC-212: its steps 2 and 3 and its expected response are pending. Step 1 asks alice to remove tc-repo from Apollo's repositories, which no
      // SC offers a project's admin; the nearest is alice, as tc-repo's admin, withdrawing
      // Apollo's approval (SC-110). Steps 2 and 3, a new issue reaching the tool from GitHub,
      // wait for the GitHub change handler (SC-023, FR-157). This checks what the register holds
      // for that handler: Apollo no longer pulls, and keeps the role, so no project receives
      // tc-repo's new issues (SRC-215).
      const repoId = await registeredBy(alice)
      const apollo = await createdBy(alice, 'Apollo')
      const requestId = await added(alice, apollo, repoId, alice)
      expect((await mark(alice, apollo, repoId)).statusCode).toBe(200)
      // Step 1 (as available): Apollo stops pulling issues from tc-repo.
      const withdrawn = await app.inject({
        method: 'POST',
        url: `/api/repository-requests/${requestId}/withdraw`,
        headers: as(alice),
      })
      expect(withdrawn.statusCode).toBe(200)

      expect(await services.projectRepositories.pulls(apollo, repoId)).toBe(false)
      expect(await receivingOf(alice, apollo)).toMatchObject([{ pulls: false }])
      // The negative assertion, that Apollo keeps its tasks from tc-repo, needs a task that came
      // from tc-repo, which only the GitHub change handler (SC-023) brings in; pending with it.
    })
  })

  describe('the done criterion, end to end', () => {
    it('refuses a second receiving project, and lets one be marked once the role is given up', async () => {
      const repoId = await registeredBy(alice)
      const apollo = await createdBy(alice, 'Apollo')
      const borealis = await createdBy(bob, 'Borealis')
      await added(alice, apollo, repoId, alice)
      await added(bob, borealis, repoId, alice)
      expect((await mark(alice, apollo, repoId)).statusCode).toBe(200)

      const second = await mark(bob, borealis, repoId)
      expect(second.statusCode).toBe(409)
      expect(second.json()).toMatchObject({ message: ALREADY_RECEIVING_MESSAGE })
      // Only the receiving project's admin gives the role up.
      expect((await giveUp(bob, borealis, repoId)).statusCode).toBe(409)
      const hidden = await giveUp(bob, apollo, repoId)
      expect(hidden.statusCode).toBe(403)
      expect(hidden.json()).toMatchObject({ error: 'Not Visible' })

      expect((await giveUp(alice, apollo, repoId)).statusCode).toBe(204)
      expect(await receivingOf(alice, apollo)).toEqual([])
      expect((await mark(bob, borealis, repoId)).statusCode).toBe(200)
      expect(await receivingOf(bob, borealis)).toMatchObject([{ repository: { id: repoId } }])
    })

    it('refuses with 400 a project that does not pull from the repository', async () => {
      const repoId = await registeredBy(alice)
      const apollo = await createdBy(bob, 'Apollo')
      const response = await mark(bob, apollo, repoId)
      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ message: NOT_PULLING_MESSAGE })
    })
  })
})
