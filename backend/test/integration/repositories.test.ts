import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  auditLog,
  projectMembers,
  projects,
  repositories,
  repositoryAdmins,
} from '../../src/db/schema.ts'
import { GitHubUnavailableError, type RepositoryReach } from '../../src/github/repository-reach.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { RepositoryService, type RegisteredRepository } from '../../src/service/repositories.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { fakeGitHub, type FakeGitHub } from '../helpers/github.ts'
import { seedProject } from '../helpers/projects.ts'

// The repository registry (SC-019) against a real PostgreSQL: its rules through the service, then
// the test cases of FR-166, FR-167, FR-169, FR-174, FR-175 and FR-176 through the REST API, with
// the tool's GitHub App answered by a fake GitHub through the real GitHub client.

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

const usernames = (repository: RegisteredRepository) => repository.admins.map((a) => a.username)

describe('the repository service', () => {
  let x: TestDatabase
  let github: FakeGitHub
  let service: RepositoryService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded
  let n = 0
  /** A repository on GitHub with the App installed, under a name no other test uses. */
  const onGitHub = (options?: { installed?: boolean }) =>
    github.createRepository(`Octo-${++n}/Repo-${n}`, options)

  beforeAll(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    service = new RepositoryService(x.db, new AuditLogService(x.db), github.reach)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const registered = async (account: Seeded) => {
    const repo = onGitHub()
    return service.registerRepository(by(account), { owner: repo.owner, name: repo.name })
  }
  const entriesFor = (id: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)

  describe('registerRepository', () => {
    it('registers the repository under GitHub’s id and name, with its registrant as only admin', async () => {
      const repo = onGitHub()
      const created = await service.registerRepository(by(alice), {
        owner: repo.owner,
        name: repo.name,
      })
      expect(created).toEqual({
        id: expect.any(String),
        githubId: repo.id,
        owner: repo.owner,
        name: repo.name,
        admins: [{ accountId: alice.id, username: 'alice' }],
      })
      expect(
        await x.db.select().from(repositories).where(eq(repositories.id, created.id)),
      ).toMatchObject([{ githubId: repo.id, registeredBy: alice.id }])
      const entries = await entriesFor(created.id)
      expect(entries).toMatchObject([
        {
          action: 'repository.registered',
          actorAccountId: alice.id,
          channels: ['ui'],
          projectId: null,
          subjectType: 'repository',
          details: { repository: `${repo.owner}/${repo.name}`, githubId: repo.id },
        },
      ])
    })

    it('keeps the name as GitHub gives it, whatever case and spaces it was asked with', async () => {
      const repo = onGitHub()
      const created = await service.registerRepository(by(alice), {
        owner: `  ${repo.owner.toUpperCase()} `,
        name: ` ${repo.name.toLowerCase()}`,
      })
      expect([created.owner, created.name]).toEqual([repo.owner, repo.name])
    })

    it('lets a system admin register one too, and makes them its admin', async () => {
      expect(usernames(await registered(root))).toEqual(['root'])
    })

    it('refuses a repository already registered, under any case, and changes nothing', async () => {
      const repo = onGitHub()
      const first = await service.registerRepository(by(alice), {
        owner: repo.owner,
        name: repo.name,
      })
      const error = await refused(
        service.registerRepository(by(bob), {
          owner: repo.owner.toLowerCase(),
          name: repo.name.toUpperCase(),
        }),
        'conflict',
      )
      expect(error.message).toBe(
        `${repo.owner.toLowerCase()}/${repo.name.toUpperCase()} is already registered`,
      )
      expect(
        await x.db.select().from(repositories).where(eq(repositories.githubId, repo.id)),
      ).toHaveLength(1)
      expect(usernames(await service.getRepository(by(bob), first.id))).toEqual(['alice'])
    })

    it('still refuses a registered repository as registered when the tool no longer reaches it', async () => {
      const repo = onGitHub()
      await service.registerRepository(by(alice), repo)
      github.uninstall(`${repo.owner}/${repo.name}`)
      const error = await refused(service.registerRepository(by(bob), repo), 'conflict')
      expect(error.message).toBe(`${repo.owner}/${repo.name} is already registered`)
    })

    it('still refuses a registered repository as registered when GitHub cannot tell', async () => {
      const repo = onGitHub()
      await service.registerRepository(by(alice), repo)
      const offline = new RepositoryService(x.db, new AuditLogService(x.db), {
        reach: () => Promise.reject(new GitHubUnavailableError('GitHub answered 502')),
      })
      const error = await refused(offline.registerRepository(by(bob), repo), 'conflict')
      expect(error.message).toBe(`${repo.owner}/${repo.name} is already registered`)
    })

    it('registers a new repository created under the old name of a registered one renamed since', async () => {
      const repo = onGitHub()
      const first = await service.registerRepository(by(alice), repo)
      github.rename(`${repo.owner}/${repo.name}`, `${repo.owner}/${repo.name}-renamed`)
      const reused = github.createRepository(`${repo.owner}/${repo.name}`)
      const second = await service.registerRepository(by(bob), repo)
      expect(second).toMatchObject({ githubId: reused.id, owner: repo.owner, name: repo.name })
      expect(second.id).not.toBe(first.id)
      expect(usernames(second)).toEqual(['bob'])
    })

    it('refuses a repository renamed on GitHub since it was registered, by GitHub’s id', async () => {
      const repo = onGitHub()
      await service.registerRepository(by(alice), { owner: repo.owner, name: repo.name })
      // The same repository on GitHub, now under a new name: GitHub gives the same id.
      github.rename(`${repo.owner}/${repo.name}`, `${repo.owner}/${repo.name}-renamed`)
      const error = await refused(
        service.registerRepository(by(bob), { owner: repo.owner, name: `${repo.name}-renamed` }),
        'conflict',
      )
      expect(error.message).toBe(`${repo.owner}/${repo.name}-renamed is already registered`)
      expect(
        await x.db.select().from(repositories).where(eq(repositories.githubId, repo.id)),
      ).toHaveLength(1)
    })

    it('reaches repositories through a personal access token as through an App (DD-060)', async () => {
      const viaToken = fakeGitHub({ via: 'token' })
      const tokenService = new RepositoryService(x.db, new AuditLogService(x.db), viaToken.reach)
      const reached = viaToken.createRepository(`Token-${++n}/Repo-${n}`)
      const closed = viaToken.createRepository(`Token-${++n}/Repo-${n}`, { installed: false })
      const created = await tokenService.registerRepository(by(alice), reached)
      expect(created).toMatchObject({ githubId: reached.id, owner: reached.owner })
      await refused(tokenService.registerRepository(by(alice), closed), 'invalid')
      // Asked with the token alone: no App installation is looked up.
      expect(viaToken.requests.every((r) => !r.includes('installation'))).toBe(true)
    })

    it('refuses a repository the App is not installed on, and one that does not exist', async () => {
      const closed = onGitHub({ installed: false })
      for (const asked of [
        { owner: closed.owner, name: closed.name },
        { owner: 'nobody', name: 'nothing' },
      ]) {
        const error = await refused(service.registerRepository(by(alice), asked), 'invalid')
        expect(error.message).toMatch(/^The tool cannot reach .* on GitHub/)
      }
      expect(
        await x.db.select().from(repositories).where(eq(repositories.githubId, closed.id)),
      ).toEqual([])
    })

    it.each([
      ['an empty owner', { owner: ' ', name: 'repo' }],
      ['an empty name', { owner: 'octo', name: '' }],
      ['a path in the owner', { owner: '../admin', name: 'repo' }],
      ['a slash in the name', { owner: 'octo', name: 'a/b' }],
      ['the name ..', { owner: 'octo', name: '..' }],
    ])('refuses %s as not a repository name, before asking GitHub', async (_, asked) => {
      const before = github.requests.length
      const error = await refused(service.registerRepository(by(alice), asked), 'invalid')
      expect(error.message).toMatch(/is not a GitHub repository name$/)
      expect(github.requests.length).toBe(before)
    })

    it('refuses as unavailable when GitHub cannot tell, and registers nothing', async () => {
      const failing: RepositoryReach = {
        reach: () => Promise.reject(new GitHubUnavailableError('GitHub answered 502')),
      }
      const offline = new RepositoryService(x.db, new AuditLogService(x.db), failing)
      const error = await refused(
        offline.registerRepository(by(alice), { owner: 'octo', name: 'down' }),
        'unavailable',
      )
      expect(error.message).toBe(
        'GitHub could not tell whether the tool can reach octo/down; try again later',
      )
    })

    it('refuses as unavailable when the tool was given no access to GitHub', async () => {
      const without = new RepositoryService(x.db, new AuditLogService(x.db))
      const error = await refused(
        without.registerRepository(by(alice), { owner: 'octo', name: 'none' }),
        'unavailable',
      )
      expect(error.message).toMatch(/^GitHub could not tell/)
    })

    it('lets any other failure through as it is', async () => {
      const broken = new RepositoryService(x.db, new AuditLogService(x.db), {
        reach: () => Promise.reject(new TypeError('bug')),
      })
      await expect(
        broken.registerRepository(by(alice), { owner: 'octo', name: 'bug' }),
      ).rejects.toThrow(TypeError)
    })

    it('lets a database failure other than a second registration through as it is', async () => {
      // An id the database cannot keep, which GitHub never gives.
      const odd = new RepositoryService(x.db, new AuditLogService(x.db), {
        reach: async () => ({ githubId: 0.5, owner: 'octo', name: 'odd' }),
      })
      const error = await odd.registerRepository(by(alice), { owner: 'octo', name: 'odd' }).then(
        () => undefined,
        (e: unknown) => e,
      )
      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(ServiceError)
      expect(await x.db.select().from(repositories).where(eq(repositories.owner, 'octo'))).toEqual(
        [],
      )
    })

    it('registers once when two people register the same repository at the same moment', async () => {
      const repo = onGitHub()
      const asked = { owner: repo.owner, name: repo.name }
      const results = await Promise.allSettled([
        service.registerRepository(by(alice), asked),
        service.registerRepository(by(bob), asked),
      ])
      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0]?.reason).toMatchObject({ name: 'ServiceError', kind: 'conflict' })
      const rows = await x.db.select().from(repositories).where(eq(repositories.githubId, repo.id))
      expect(rows).toHaveLength(1)
      expect(
        await x.db
          .select()
          .from(repositoryAdmins)
          .where(eq(repositoryAdmins.repositoryId, rows[0]!.id)),
      ).toHaveLength(1)
    })

    it('refuses a caller without an account', async () => {
      const repo = onGitHub()
      const asked = github.requests.length
      for (const accountId of ['6f1c2a5e-0000-4000-8000-00000000dead', 'not-a-uuid']) {
        await refused(
          service.registerRepository({ accountId, channel: 'rest-api' }, repo),
          'forbidden',
        )
      }
      // Refused before GitHub is asked, and nothing is registered.
      expect(github.requests.length).toBe(asked)
      expect(
        await x.db.select().from(repositories).where(eq(repositories.githubId, repo.id)),
      ).toEqual([])
    })
  })

  describe('listRepositories and getRepository', () => {
    it('lists every repository once, by owner and name, with its admins by username', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, carol.id)
      await service.addAdmin(by(alice), a.id, bob.id)
      const listed = await service.listRepositories(by(carol))
      expect(listed.filter((r) => r.id === a.id)).toEqual([
        {
          ...a,
          admins: ['alice', 'bob', 'carol'].map((u) => ({
            accountId: { alice: alice.id, bob: bob.id, carol: carol.id }[u],
            username: u,
          })),
        },
      ])
      const names = listed.map((r) => `${r.owner}/${r.name}`.toLowerCase())
      expect(names).toEqual([...names].sort())
      expect(new Set(listed.map((r) => r.id)).size).toBe(listed.length)
    })

    it('shows a repository to anyone with an account, admin of it or not', async () => {
      const a = await registered(alice)
      expect(await service.getRepository(by(bob), a.id)).toEqual(a)
    })

    it('answers a repository that does not exist as not found', async () => {
      await refused(
        service.getRepository(by(bob), '6f1c2a5e-0000-4000-8000-0000000000ff'),
        'not-found',
      )
      const error = await refused(service.getRepository(by(bob), 'nope'), 'not-found')
      expect(error.message).toBe('There is no such repository')
    })

    it('refuses a caller without an account', async () => {
      const nobody = { accountId: '6f1c2a5e-0000-4000-8000-00000000dead', channel: 'ui' } as const
      const listing = await refused(service.listRepositories(nobody), 'forbidden')
      expect(listing.message).toBe('Only people with an account can see the repositories')
      const a = await registered(alice)
      await refused(service.getRepository(nobody, a.id), 'forbidden')
    })
  })

  describe('addAdmin', () => {
    it('lets an admin make another person an admin, and records it', async () => {
      const a = await registered(alice)
      const changed = await service.addAdmin(by(alice), a.id, bob.id)
      expect(usernames(changed)).toEqual(['alice', 'bob'])
      expect((await entriesFor(a.id)).at(-1)).toMatchObject({
        action: 'repository.admin-added',
        actorAccountId: alice.id,
        details: { repository: `${a.owner}/${a.name}`, accountId: bob.id, username: 'bob' },
      })
    })

    it('lets a system admin who is not its admin add one, without becoming one', async () => {
      const a = await registered(alice)
      expect(usernames(await service.addAdmin(by(root), a.id, bob.id))).toEqual(['alice', 'bob'])
    })

    it('lets an admin made by another admin add admins in turn', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, bob.id)
      expect(usernames(await service.addAdmin(by(bob), a.id, carol.id))).toEqual([
        'alice',
        'bob',
        'carol',
      ])
    })

    it('changes nothing, and records nothing, for someone already an admin', async () => {
      const a = await registered(alice)
      const before = (await entriesFor(a.id)).length
      expect(usernames(await service.addAdmin(by(alice), a.id, alice.id))).toEqual(['alice'])
      expect(await entriesFor(a.id)).toHaveLength(before)
    })

    it('refuses anyone who is neither its admin nor a system admin', async () => {
      const a = await registered(alice)
      const error = await refused(service.addAdmin(by(bob), a.id, bob.id), 'forbidden')
      expect(error.message).toBe(
        "Only the repository's admins and system admins can change its admins",
      )
      expect(usernames(await service.getRepository(by(bob), a.id))).toEqual(['alice'])
    })

    it('refuses an account that does not exist, and a repository that does not exist', async () => {
      const a = await registered(alice)
      await refused(
        service.addAdmin(by(alice), a.id, '6f1c2a5e-0000-4000-8000-0000000000ee'),
        'not-found',
      )
      await refused(service.addAdmin(by(alice), a.id, 'nobody'), 'not-found')
      await refused(
        service.addAdmin(by(alice), '6f1c2a5e-0000-4000-8000-0000000000ff', bob.id),
        'not-found',
      )
      await refused(service.addAdmin(by(alice), 'nope', bob.id), 'not-found')
      expect(usernames(await service.getRepository(by(alice), a.id))).toEqual(['alice'])
    })

    it('refuses a caller without an account', async () => {
      const a = await registered(alice)
      await refused(
        service.addAdmin({ accountId: 'ghost', channel: 'ui' }, a.id, bob.id),
        'forbidden',
      )
      expect(usernames(await service.getRepository(by(alice), a.id))).toEqual(['alice'])
    })
  })

  describe('removeAdmin', () => {
    it('lets an admin remove another admin, and records it', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, bob.id)
      await service.removeAdmin(by(alice), a.id, bob.id)
      expect(usernames(await service.getRepository(by(alice), a.id))).toEqual(['alice'])
      expect((await entriesFor(a.id)).at(-1)).toMatchObject({
        action: 'repository.admin-removed',
        actorAccountId: alice.id,
        details: { repository: `${a.owner}/${a.name}`, accountId: bob.id, username: 'bob' },
      })
    })

    it('lets an admin step down while another remains', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, bob.id)
      await service.removeAdmin(by(alice), a.id, alice.id)
      expect(usernames(await service.getRepository(by(bob), a.id))).toEqual(['bob'])
    })

    it('refuses to remove the last admin, to the admin and to a system admin alike', async () => {
      const a = await registered(alice)
      const before = (await entriesFor(a.id)).length
      for (const caller of [alice, root]) {
        const error = await refused(service.removeAdmin(by(caller), a.id, alice.id), 'conflict')
        expect(error.message).toBe(
          `${a.owner}/${a.name} cannot be left without an admin: make someone else its admin first`,
        )
      }
      expect(usernames(await service.getRepository(by(alice), a.id))).toEqual(['alice'])
      expect(await entriesFor(a.id)).toHaveLength(before)
    })

    it('never leaves a repository without an admin when two admins remove each other at once', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, bob.id)
      const results = await Promise.allSettled([
        service.removeAdmin(by(alice), a.id, bob.id),
        service.removeAdmin(by(bob), a.id, alice.id),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect((await service.getRepository(by(alice), a.id)).admins).toHaveLength(1)
    })

    it('refuses anyone who is neither its admin nor a system admin', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, bob.id)
      await refused(service.removeAdmin(by(carol), a.id, bob.id), 'forbidden')
      expect(usernames(await service.getRepository(by(carol), a.id))).toEqual(['alice', 'bob'])
    })

    it('answers someone who is not its admin, and a repository that does not exist, as not found', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, bob.id)
      const error = await refused(service.removeAdmin(by(alice), a.id, carol.id), 'not-found')
      expect(error.message).toBe('That person is not an admin of this repository')
      await refused(
        service.removeAdmin(by(alice), '6f1c2a5e-0000-4000-8000-0000000000ff', bob.id),
        'not-found',
      )
    })

    it('refuses a caller without an account', async () => {
      const a = await registered(alice)
      await service.addAdmin(by(alice), a.id, bob.id)
      await refused(
        service.removeAdmin({ accountId: 'ghost', channel: 'ui' }, a.id, alice.id),
        'forbidden',
      )
      expect(usernames(await service.getRepository(by(alice), a.id))).toEqual(['alice', 'bob'])
    })
  })
})

describe('test cases through the REST API', () => {
  // Each test case starts from its own fresh test deployment, as the test cases ask.
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let github: FakeGitHub
  let root: Seeded
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    github = fakeGitHub()
    app = buildApp(
      {},
      {
        authenticators: [testAuthenticator],
        services: createServices(x.db, { github: github.reach }),
      },
    )
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const register = (account: Seeded, fullName: string) => {
    const [owner, name] = fullName.split('/')
    return app.inject({
      method: 'POST',
      url: '/api/repositories',
      headers: as(account),
      payload: { owner, name },
    })
  }
  const list = (account: Seeded) =>
    app.inject({ method: 'GET', url: '/api/repositories', headers: as(account) })
  const read = (account: Seeded, id: string) =>
    app.inject({ method: 'GET', url: `/api/repositories/${id}`, headers: as(account) })
  const addAdmin = (account: Seeded, id: string, admin: Seeded) =>
    app.inject({
      method: 'POST',
      url: `/api/repositories/${id}/admins`,
      headers: as(account),
      payload: { accountId: admin.id },
    })
  const removeAdmin = (account: Seeded, id: string, admin: Seeded) =>
    app.inject({
      method: 'DELETE',
      url: `/api/repositories/${id}/admins/${admin.id}`,
      headers: as(account),
    })
  const adminsOf = async (account: Seeded, id: string) =>
    (await read(account, id)).json<RegisteredRepository>().admins.map((a) => a.username)

  /** `tc-repo` on GitHub with the tool's App installed, registered in the tool by `registrant`. */
  async function tcRepoRegisteredBy(registrant: Seeded): Promise<string> {
    github.createRepository('csillagu/tc-repo')
    const registered = await register(registrant, 'csillagu/tc-repo')
    expect(registered.statusCode).toBe(201)
    return registered.json<RegisteredRepository>().id
  }

  describe('TC-241: a registered repository is its own item with its admins', () => {
    it('lists tc-repo once, as its own item, with admins [alice]', async () => {
      const id = await tcRepoRegisteredBy(alice)
      // Apollo and Borealis, created by alice and bob. Their pulling issues from tc-repo is
      // SC-110's, which is not built yet; the repository is an item apart from them either way.
      await seedProject(x.db, alice, 'Apollo')
      await seedProject(x.db, bob, 'Borealis')

      const item = await read(alice, id)
      expect(item.statusCode).toBe(200)
      expect(item.json()).toMatchObject({
        id,
        owner: 'csillagu',
        name: 'tc-repo',
        admins: [{ accountId: alice.id, username: 'alice' }],
      })

      const listed = await list(alice)
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual([item.json()])

      // Negative: bob, admin of Borealis, is not one of tc-repo's admins.
      expect(await adminsOf(bob, id)).not.toContain('bob')
    })
  })

  describe('TC-242: anyone with an account registers an unregistered repository', () => {
    it('registers tc-repo for erin, with no role anywhere, and makes erin its admin', async () => {
      const erin = await seedAccount(x.db, { username: 'erin' })
      github.createRepository('csillagu/tc-repo')

      const registered = await register(erin, 'csillagu/tc-repo')
      expect(registered.statusCode).toBe(201)
      const { id } = registered.json<RegisteredRepository>()
      expect(await adminsOf(erin, id)).toEqual(['erin'])

      // Negative: no project is created or changed.
      expect(await x.db.select().from(projects)).toEqual([])
      expect(await x.db.select().from(projectMembers)).toEqual([])
    })
  })

  describe('TC-243: registering an already registered repository is rejected', () => {
    it('rejects bob registering tc-repo, which alice registered', async () => {
      const id = await tcRepoRegisteredBy(alice)

      const attempt = await register(bob, 'csillagu/tc-repo')
      expect(attempt.statusCode).toBe(409)

      const listed = (await list(bob)).json<RegisteredRepository[]>()
      expect(listed.map((r) => r.id)).toEqual([id])
      expect(await adminsOf(bob, id)).toEqual(['alice'])
      // Negative: bob is not an admin of tc-repo.
      expect(await adminsOf(bob, id)).not.toContain('bob')
    })
  })

  describe('TC-244: a repository the GitHub App cannot reach cannot be registered', () => {
    it('rejects erin registering tc-closed, on which the App is not installed', async () => {
      const erin = await seedAccount(x.db, { username: 'erin' })
      github.createRepository('csillagu/tc-closed', { installed: false })

      const attempt = await register(erin, 'csillagu/tc-closed')
      expect(attempt.statusCode).toBe(400)

      // Negative: tc-closed is not registered.
      expect((await list(erin)).json()).toEqual([])
    })
  })

  describe("TC-248: a system admin changes a repository's admins", () => {
    it('lets root add bob and then remove alice, without becoming an admin', async () => {
      const id = await tcRepoRegisteredBy(alice)

      expect((await addAdmin(root, id, bob)).statusCode).toBe(200)
      expect((await removeAdmin(root, id, alice)).statusCode).toBe(204)

      expect(await adminsOf(root, id)).toEqual(['bob'])
      // Negative: root has not become one of its admins.
      expect(await adminsOf(root, id)).not.toContain('root')
    })
  })

  describe('TC-254: a repository admin adds another admin', () => {
    it('lets alice make bob an admin of tc-repo', async () => {
      const id = await tcRepoRegisteredBy(alice)

      const added = await addAdmin(alice, id, bob)
      expect(added.statusCode).toBe(200)

      expect(await adminsOf(alice, id)).toEqual(['alice', 'bob'])
      // Negative: alice is still an admin.
      expect(await adminsOf(alice, id)).toContain('alice')
    })
  })

  describe("TC-255: a repository's only admin cannot step down", () => {
    it("rejects alice stepping down as tc-repo's only admin", async () => {
      const id = await tcRepoRegisteredBy(alice)

      const attempt = await removeAdmin(alice, id, alice)
      expect(attempt.statusCode).toBe(409)

      expect(await adminsOf(alice, id)).toEqual(['alice'])
      // Negative: tc-repo is still registered.
      expect((await list(alice)).json<RegisteredRepository[]>().map((r) => r.id)).toEqual([id])
    })
  })

  describe("TC-256: a system admin cannot remove a repository's only admin", () => {
    it("rejects root removing alice, tc-repo's only admin", async () => {
      const id = await tcRepoRegisteredBy(alice)

      const attempt = await removeAdmin(root, id, alice)
      expect(attempt.statusCode).toBe(409)

      expect(await adminsOf(root, id)).toEqual(['alice'])
      // Negative: root is not made an admin of tc-repo in alice's place.
      expect(await adminsOf(root, id)).not.toContain('root')
    })
  })

  describe('TC-257: a repository admin removes another admin', () => {
    it('lets bob remove alice as admin of tc-repo', async () => {
      const id = await tcRepoRegisteredBy(alice)
      expect((await addAdmin(alice, id, bob)).statusCode).toBe(200)

      const removed = await removeAdmin(bob, id, alice)
      expect(removed.statusCode).toBe(204)

      expect(await adminsOf(bob, id)).toEqual(['bob'])
      // Negative: tc-repo is still registered.
      expect((await list(bob)).json<RegisteredRepository[]>().map((r) => r.id)).toEqual([id])
    })
  })

  describe('TC-258: a repository admin steps down while another admin remains', () => {
    it('lets alice step down, leaving bob', async () => {
      const id = await tcRepoRegisteredBy(alice)
      expect((await addAdmin(alice, id, bob)).statusCode).toBe(200)

      const removed = await removeAdmin(alice, id, alice)
      expect(removed.statusCode).toBe(204)

      const admins = (await read(bob, id)).json<RegisteredRepository>().admins
      expect(admins).toEqual([{ accountId: bob.id, username: 'bob' }])
      // Negative: bob is unchanged as admin.
      expect(
        await x.db.select().from(repositoryAdmins).where(eq(repositoryAdmins.accountId, bob.id)),
      ).toEqual([{ repositoryId: id, accountId: bob.id }])
    })
  })
})
