import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, projectMembers } from '../../src/db/schema.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import {
  highestRole,
  isProjectRole,
  PROJECT_ROLES,
  ProjectRoleService,
  type ProjectRole,
} from '../../src/service/project-roles.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { groupTable } from '../helpers/group-roles.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The project role store (SC-014) against a real PostgreSQL: its rules, then the test cases of
// FR-105, FR-109, FR-110, FR-111 and FR-112, as far as the parts built so far reach. The rules
// tests give projects and roles straight in the database; the test cases create their projects
// through the REST API (SC-017).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

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

describe('the roles and their order', () => {
  it('knows the four roles, lowest first', () => {
    expect(PROJECT_ROLES).toEqual(['read-only', 'contributor', 'read-write', 'admin'])
    for (const role of PROJECT_ROLES) expect(isProjectRole(role)).toBe(true)
    for (const other of ['owner', 'read', 'write', '', 3, undefined]) {
      expect(isProjectRole(other)).toBe(false)
    }
  })

  it('takes the highest of several roles, in any order, and none of none', () => {
    expect(highestRole(['read-only', 'read-write'])).toBe('read-write')
    expect(highestRole(['admin', 'contributor', 'read-only'])).toBe('admin')
    expect(highestRole(['contributor', 'read-only'])).toBe('contributor')
    expect(highestRole(['read-only'])).toBe('read-only')
    expect(highestRole([])).toBeUndefined()
  })
})

describe('the project role store', () => {
  let x: TestDatabase
  let groups: ReturnType<typeof groupTable>
  let store: ProjectRoleService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    groups = groupTable()
    store = new ProjectRoleService(x.db, new AuditLogService(x.db), groups)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const entriesOf = (projectId: string) =>
    x.db.select().from(auditLog).where(eq(auditLog.projectId, projectId)).orderBy(auditLog.id)

  describe('roleOf', () => {
    it('answers the role held directly, and nothing where none is held', async () => {
      const p = await seedProject(x.db, alice)
      expect(await store.roleOf(alice.id, p)).toBe('admin')
      expect(await store.roleOf(bob.id, p)).toBeUndefined()
      expect(await store.roleOf(alice.id, randomUUID())).toBeUndefined()
    })

    it('answers nothing for an id that is not a UUID, without asking the database', async () => {
      const p = await seedProject(x.db, alice)
      expect(await store.roleOf('alice', p)).toBeUndefined()
      expect(await store.roleOf(alice.id, 'apollo')).toBeUndefined()
    })

    it('gives a system admin no role in a project they hold none in', async () => {
      const p = await seedProject(x.db, alice)
      expect(await store.roleOf(root.id, p)).toBeUndefined()
    })

    it('answers a role held only through a group', async () => {
      const p = await seedProject(x.db, alice)
      groups.give(carol, p, 'contributor')
      expect(await store.roleOf(carol.id, p)).toBe('contributor')
    })

    it('applies the highest of the direct role and the group roles, whichever is higher', async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'read-only')
      groups.give(bob, p, 'read-write')
      groups.give(bob, p, 'contributor')
      expect(await store.roleOf(bob.id, p)).toBe('read-write')

      const q = await seedProject(x.db, alice)
      await grantRole(x.db, bob, q, 'admin')
      groups.give(bob, q, 'read-only')
      expect(await store.roleOf(bob.id, q)).toBe('admin')
    })
  })

  describe('setRole', () => {
    it.each(PROJECT_ROLES)('lets the admin give someone the %s role', async (role) => {
      const p = await seedProject(x.db, alice)
      const member = await store.setRole(by(alice), p, bob.id, role)
      expect(member).toEqual({ accountId: bob.id, username: 'bob', role })
      expect(await store.roleOf(bob.id, p)).toBe(role)
    })

    it('changes a role someone holds and records the change with the role it replaced', async () => {
      const p = await seedProject(x.db, alice)
      await store.setRole(by(alice), p, bob.id, 'read-only')
      await store.setRole(by(alice), p, bob.id, 'read-write')
      expect(await store.roleOf(bob.id, p)).toBe('read-write')
      const entries = await entriesOf(p)
      expect(entries.map((e) => [e.action, e.actorAccountId, e.subjectId, e.details])).toEqual([
        [
          'project-member.role-set',
          alice.id,
          bob.id,
          { username: 'bob', role: 'read-only', previousRole: null },
        ],
        [
          'project-member.role-set',
          alice.id,
          bob.id,
          { username: 'bob', role: 'read-write', previousRole: 'read-only' },
        ],
      ])
      expect(entries.every((e) => e.channels.join() === 'ui')).toBe(true)
    })

    it('changes nothing and records nothing when the person already holds the role', async () => {
      const p = await seedProject(x.db, alice)
      await store.setRole(by(alice), p, bob.id, 'contributor')
      const member = await store.setRole(by(alice), p, bob.id, 'contributor')
      expect(member.role).toBe('contributor')
      expect(await entriesOf(p)).toHaveLength(1)
    })

    it('lets someone who is admin through a group manage the members', async () => {
      const p = await seedProject(x.db, alice)
      groups.give(carol, p, 'admin')
      await store.setRole(by(carol), p, bob.id, 'read-only')
      expect(await store.roleOf(bob.id, p)).toBe('read-only')
    })

    it.each(['read-only', 'contributor', 'read-write'] as const)(
      'refuses a %s member, who is not admin, and changes nothing',
      async (role) => {
        const p = await seedProject(x.db, alice)
        await grantRole(x.db, bob, p, role)
        const error = await refused(store.setRole(by(bob), p, carol.id, 'admin'), 'forbidden')
        expect(error.message).toBe(
          "Only the project's admins can manage its members, roles, repositories and settings",
        )
        expect(await store.roleOf(carol.id, p)).toBeUndefined()
        expect(await store.roleOf(bob.id, p)).toBe(role)
      },
    )

    it('tells a system admin with no role in the project, and anyone with none, that it is not visible to them', async () => {
      const p = await seedProject(x.db, alice)
      await refused(store.setRole(by(root), p, bob.id, 'admin'), 'not-visible')
      await refused(store.setRole(by(carol), p, carol.id, 'admin'), 'not-visible')
      expect(await store.roleOf(bob.id, p)).toBeUndefined()
      expect(await store.roleOf(carol.id, p)).toBeUndefined()
    })

    it('refuses a non-admin before it checks the role or the person', async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'read-write')
      const error = await refused(store.setRole(by(bob), p, 'nobody', 'owner'), 'forbidden')
      expect(error.message).toBe(
        "Only the project's admins can manage its members, roles, repositories and settings",
      )
    })

    it('refuses a role outside the four', async () => {
      const p = await seedProject(x.db, alice)
      const error = await refused(store.setRole(by(alice), p, bob.id, 'owner'), 'invalid')
      expect(error.message).toBe(
        'A project role is one of read-only, contributor, read-write, admin',
      )
    })

    it('refuses a person who has no account', async () => {
      const p = await seedProject(x.db, alice)
      for (const nobody of [randomUUID(), 'not-a-uuid']) {
        const error = await refused(store.setRole(by(alice), p, nobody, 'read-only'), 'not-found')
        expect(error.message).toBe('There is no such account')
      }
    })

    it('answers a project id that is not a UUID as a project not visible to the caller', async () => {
      const error = await refused(
        store.setRole(by(alice), 'apollo', bob.id, 'read-only'),
        'not-visible',
      )
      expect(error.message).toBe('This project is not visible to you')
    })

    it("refuses to take the admin role from the project's last admin, alice herself included", async () => {
      const p = await seedProject(x.db, alice)
      const error = await refused(store.setRole(by(alice), p, alice.id, 'read-write'), 'conflict')
      expect(error.message).toBe("The project's last admin cannot be removed")
      expect(await store.roleOf(alice.id, p)).toBe('admin')
      expect(await entriesOf(p)).toHaveLength(0)
    })

    it('lets an admin step down once another admin holds the role directly', async () => {
      const p = await seedProject(x.db, alice)
      await store.setRole(by(alice), p, bob.id, 'admin')
      await store.setRole(by(alice), p, alice.id, 'read-write')
      expect(await store.roleOf(alice.id, p)).toBe('read-write')
      expect(await store.roleOf(bob.id, p)).toBe('admin')
    })

    it('counts only direct admins: an admin through a group does not make the last direct admin removable', async () => {
      const p = await seedProject(x.db, alice)
      groups.give(carol, p, 'admin')
      await refused(store.setRole(by(carol), p, alice.id, 'read-only'), 'conflict')
      expect(await store.roleOf(alice.id, p)).toBe('admin')
    })

    it('never leaves a project without an admin when its two admins step down at once', async () => {
      const p = await seedProject(x.db, alice)
      await store.setRole(by(alice), p, bob.id, 'admin')
      const results = await Promise.allSettled([
        store.setRole(by(alice), p, alice.id, 'read-only'),
        store.setRole(by(bob), p, bob.id, 'read-only'),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      // The one that waited finds itself the last admin.
      const [lost] = results.filter((r) => r.status === 'rejected')
      expect(lost?.reason).toBeInstanceOf(ServiceError)
      expect(lost?.reason).toMatchObject({ kind: 'conflict' })
      const admins = await x.db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, p), eq(projectMembers.role, 'admin')))
      expect(admins).toHaveLength(1)
    })
  })

  describe('setRoleByUsername', () => {
    it('gives the person with the username the role, matching the name as sign-in does', async () => {
      const p = await seedProject(x.db, alice)
      expect(await store.setRoleByUsername(by(alice), p, ' BOB ', 'contributor')).toEqual({
        accountId: bob.id,
        username: 'bob',
        role: 'contributor',
      })
      expect(await store.roleOf(bob.id, p)).toBe('contributor')
      await store.setRoleByUsername(by(alice), p, 'bob', 'read-write')
      expect(await store.roleOf(bob.id, p)).toBe('read-write')
      expect((await entriesOf(p)).map((e) => e.action)).toEqual([
        'project-member.role-set',
        'project-member.role-set',
      ])
    })

    it('refuses a username no account has', async () => {
      const p = await seedProject(x.db, alice)
      const error = await refused(
        store.setRoleByUsername(by(alice), p, 'nobody', 'read-only'),
        'not-found',
      )
      expect(error.message).toBe('There is no such account')
      expect(await entriesOf(p)).toHaveLength(0)
    })

    it('refuses a non-admin before it looks the username up, so they learn nothing of it', async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'read-write')
      await refused(store.setRoleByUsername(by(bob), p, 'nobody', 'read-only'), 'forbidden')
      await refused(store.setRoleByUsername(by(carol), p, 'nobody', 'read-only'), 'not-visible')
      expect(await entriesOf(p)).toHaveLength(0)
    })

    it("keeps the project's last admin, as setRole does", async () => {
      const p = await seedProject(x.db, alice)
      await refused(store.setRoleByUsername(by(alice), p, 'alice', 'read-only'), 'conflict')
      expect(await store.roleOf(alice.id, p)).toBe('admin')
    })
  })

  describe('removeMember', () => {
    it("removes a member's direct role and records it", async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'read-write')
      await store.removeMember(by(alice), p, bob.id)
      expect(await store.roleOf(bob.id, p)).toBeUndefined()
      const entries = await entriesOf(p)
      expect(entries.map((e) => [e.action, e.subjectId, e.details])).toEqual([
        ['project-member.removed', bob.id, { username: 'bob', previousRole: 'read-write' }],
      ])
    })

    it('leaves the roles a member holds through groups with the groups', async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'admin')
      groups.give(bob, p, 'read-only')
      await store.removeMember(by(alice), p, bob.id)
      expect(await store.roleOf(bob.id, p)).toBe('read-only')
    })

    it('refuses someone who is not admin and removes nobody', async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'read-write')
      await refused(store.removeMember(by(bob), p, alice.id), 'forbidden')
      await refused(store.removeMember(by(root), p, bob.id), 'not-visible')
      expect(await store.roleOf(alice.id, p)).toBe('admin')
      expect(await store.roleOf(bob.id, p)).toBe('read-write')
    })

    it('refuses as not found someone who holds no direct role there', async () => {
      const p = await seedProject(x.db, alice)
      groups.give(carol, p, 'read-write')
      await refused(store.removeMember(by(alice), p, carol.id), 'not-found')
      await refused(store.removeMember(by(alice), p, randomUUID()), 'not-found')
      await refused(store.removeMember(by(alice), p, 'carol'), 'not-found')
      expect(await entriesOf(p)).toHaveLength(0)
    })

    it('lets an admin be removed while another admin remains', async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'admin')
      await store.removeMember(by(bob), p, alice.id)
      expect(await store.roleOf(alice.id, p)).toBeUndefined()
      expect(await store.roleOf(bob.id, p)).toBe('admin')
    })

    it('never leaves a project without an admin when its two admins are removed at once', async () => {
      const p = await seedProject(x.db, alice)
      await grantRole(x.db, bob, p, 'admin')
      const results = await Promise.allSettled([
        store.removeMember(by(alice), p, bob.id),
        store.removeMember(by(bob), p, alice.id),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      // The one that waited is no longer a member, so the project is no longer visible to them.
      const [lost] = results.filter((r) => r.status === 'rejected')
      expect(lost?.reason).toBeInstanceOf(ServiceError)
      expect(lost?.reason).toMatchObject({ kind: 'not-visible' })
      const admins = await x.db
        .select()
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, p), eq(projectMembers.role, 'admin')))
      expect(admins).toHaveLength(1)
    })
  })

  describe('listMembers', () => {
    it.each(PROJECT_ROLES)(
      'lets a %s member read the direct members by username, with their roles',
      async (role) => {
        const p = await seedProject(x.db, carol)
        await grantRole(x.db, bob, p, role)
        await grantRole(x.db, alice, p, 'read-only')
        const members = await store.listMembers(by(bob), p)
        expect(members).toEqual([
          { accountId: alice.id, username: 'alice', role: 'read-only' },
          { accountId: bob.id, username: 'bob', role },
          { accountId: carol.id, username: 'carol', role: 'admin' },
        ])
      },
    )

    it('lets someone with a role through a group read them', async () => {
      const p = await seedProject(x.db, alice)
      groups.give(carol, p, 'read-only')
      expect((await store.listMembers(by(carol), p)).map((m) => m.username)).toEqual(['alice'])
    })

    it('tells someone with no role there, a system admin included, that it is not visible to them', async () => {
      const p = await seedProject(x.db, alice)
      for (const caller of [by(bob), by(root)]) {
        const error = await refused(store.listMembers(caller, p), 'not-visible')
        expect(error.message).toBe('This project is not visible to you')
      }
    })
  })

  // The role store's part of FR-111's and FR-112's test cases: a group's role is given through
  // the stand-in above, and the role the store applies is read. The test cases in full, with
  // groups and tasks through the REST API, are at the end of this file.
  describe('TC-162: a group member holds the group role on every project in the group', () => {
    it('gives bob the write role on Apollo and Borealis, and not the admin role', async () => {
      const [apollo, borealis] = [await seedProject(x.db, alice), await seedProject(x.db, alice)]
      // alice adds bob to Platform, which holds Apollo and Borealis, with the write role.
      for (const p of [apollo, borealis]) groups.give(bob, p, 'read-write')
      for (const p of [apollo, borealis]) {
        expect(await store.roleOf(bob.id, p)).toBe('read-write')
        // Negative: bob cannot manage members of either project, since write is not admin.
        await refused(store.setRole(by(bob), p, carol.id, 'read-only'), 'forbidden')
        await refused(store.removeMember(by(bob), p, alice.id), 'forbidden')
      }
    })
  })

  describe('TC-163: a removed group member loses the group role on its projects', () => {
    it('takes the write role on Apollo from bob once he leaves Platform', async () => {
      const apollo = await seedProject(x.db, alice)
      groups.give(bob, apollo, 'read-write')
      expect(await store.roleOf(bob.id, apollo)).toBe('read-write')
      // alice removes bob from Platform.
      groups.takeAway(bob, apollo)
      expect(await store.roleOf(bob.id, apollo)).toBeUndefined()
      await refused(store.listMembers(by(bob), apollo), 'not-visible')
    })
  })

  describe('TC-164: of a direct read role and a group write role, write applies', () => {
    it('applies write to bob on Apollo and leaves his direct read-only role as it was', async () => {
      const apollo = await seedProject(x.db, alice)
      await store.setRole(by(alice), apollo, bob.id, 'read-only')
      groups.give(bob, apollo, 'read-write')
      expect(await store.roleOf(bob.id, apollo)).toBe('read-write')
      // Negative: bob's direct role is still read-only, not rewritten.
      const members = await store.listMembers(by(alice), apollo)
      expect(members.find((m) => m.accountId === bob.id)?.role).toBe('read-only')
    })
  })

  it('records nothing when the audit log cannot be written, and makes no change', async () => {
    class UnavailableAuditLog extends AuditLogService {
      override async record(): Promise<void> {
        throw new Error('the audit log is not available')
      }
    }
    const failing = new ProjectRoleService(x.db, new UnavailableAuditLog(x.db))
    const p = await seedProject(x.db, alice)
    await expect(failing.setRole(by(alice), p, bob.id, 'admin')).rejects.toThrow(
      'the audit log is not available',
    )
    expect(await store.roleOf(bob.id, p)).toBeUndefined()
    await grantRole(x.db, bob, p, 'read-only')
    await expect(failing.removeMember(by(alice), p, bob.id)).rejects.toThrow(
      'the audit log is not available',
    )
    expect(await store.roleOf(bob.id, p)).toBe('read-only')
  })
})

describe('test cases through the REST API', () => {
  // Each test below follows its test case through the REST API, its projects created there by
  // their creators (SC-017).
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded

  // Each test case starts from its own fresh test deployment, as the test cases ask.
  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const setRole = (as_: Seeded, projectId: string, member: Seeded, role: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}/members/${member.id}`,
      headers: as(as_),
      payload: { role },
    })

  /** A project `creator` creates through the REST API, and so is the only admin of. */
  const create = async (creator: Seeded, name: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: as(creator),
      payload: { name },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }

  const members = (as_: Seeded, projectId: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}/members`, headers: as(as_) })

  describe('TC-153: a person holds a different role in each project', () => {
    it('gives bob read-only in P1, contributor in P2, read-write in P3 and admin in P4', async () => {
      const [p1, p2, p3, p4] = [
        await create(alice, 'P1'),
        await create(alice, 'P2'),
        await create(alice, 'P3'),
        await create(alice, 'P4'),
      ]
      const given: [string, ProjectRole][] = [
        [p1, 'read-only'],
        [p2, 'contributor'],
        [p3, 'read-write'],
        [p4, 'admin'],
      ]
      for (const [p, role] of given) {
        expect((await setRole(alice, p, bob, role)).statusCode).toBe(200)
      }
      for (const [p, role] of given) {
        const response = await members(alice, p)
        expect(response.statusCode).toBe(200)
        const read: { username: string; role: string }[] = response.json()
        expect(read.find((m) => m.username === 'bob')?.role).toBe(role)
        // No role offered falls outside these four.
        for (const m of read) expect(PROJECT_ROLES).toContain(m.role)
      }
      expect((await setRole(alice, p1, bob, 'owner')).statusCode).toBe(400)
    })
  })

  describe("TC-161: removing a project's last admin is rejected", () => {
    it('rejects removing alice from Apollo, keeps her its admin, and does not make bob admin', async () => {
      const apollo = await create(alice, 'Apollo')
      await grantRole(x.db, bob, apollo, 'read-write')

      const removal = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${apollo}/members/${alice.id}`,
        headers: as(alice),
      })
      expect(removal.statusCode).toBe(409)
      expect(removal.json().message).toBe("The project's last admin cannot be removed")

      const read = (await members(alice, apollo)).json()
      expect(read).toEqual([
        { accountId: alice.id, username: 'alice', role: 'admin' },
        { accountId: bob.id, username: 'bob', role: 'read-write' },
      ])
    })
  })

  it("lets the project's admin read its audit log, as the role store says (SC-013)", async () => {
    const apollo = await seedProject(x.db, alice)
    expect((await setRole(alice, apollo, bob, 'read-only')).statusCode).toBe(200)
    const read = (as_: Seeded) =>
      app.inject({
        method: 'GET',
        url: '/api/audit-log',
        query: { projectId: apollo },
        headers: as(as_),
      })
    const response = await read(alice)
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject([
      { action: 'project-member.role-set', subject: { type: 'account', id: bob.id } },
    ])
    expect((await read(bob)).statusCode).toBe(403)
  })

  describe("TC-160: a project admin manages the project's members and their roles", () => {
    it('lets alice add bob as read-only, make him read-write, then remove him, staying admin', async () => {
      const apollo = await create(alice, 'Apollo')
      const roleOf = async (who: Seeded) => {
        const response = await members(alice, apollo)
        expect(response.statusCode).toBe(200)
        return response
          .json<{ accountId: string; role: string }[]>()
          .find((m) => m.accountId === who.id)?.role
      }

      expect((await setRole(alice, apollo, bob, 'read-only')).statusCode).toBe(200)
      expect(await roleOf(bob)).toBe('read-only')
      expect(await roleOf(alice)).toBe('admin')

      expect((await setRole(alice, apollo, bob, 'read-write')).statusCode).toBe(200)
      expect(await roleOf(bob)).toBe('read-write')
      expect(await roleOf(alice)).toBe('admin')

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/projects/${apollo}/members/${bob.id}`,
        headers: as(alice),
      })
      expect(removed.statusCode).toBe(204)
      expect(await roleOf(bob)).toBeUndefined()
      expect((await members(alice, apollo)).json()).toEqual([
        { accountId: alice.id, username: 'alice', role: 'admin' },
      ])
    })

    it('refuses bob, a read-write member, a change of the members, which is the admin’s (FR-109)', async () => {
      const apollo = await seedProject(x.db, alice)
      await grantRole(x.db, bob, apollo, 'read-write')
      const response = await setRole(bob, apollo, bob, 'admin')
      expect(response.statusCode).toBe(403)
      expect(response.json().message).toBe(
        "Only the project's admins can manage its members, roles, repositories and settings",
      )
    })
  })

  // TC-154 to TC-159 (FR-106, FR-107, FR-108) check the roles on tasks, views, baselines and AI
  // proposals. TC-155 to TC-158, on tasks, statuses and assignment, are in task-roles.test.ts.
  // Pending: TC-154 (views SC-033 and baselines SC-009; the Gantt, SC-031, the Kanban, SC-030, and
  // the person load view, SC-032, are in e2e/tests/gantt.spec.ts, e2e/tests/kanban.spec.ts and
  // e2e/tests/person-load.spec.ts), TC-159
  // (proposals SC-010, SC-048, MCP server SC-027). Each of those modules asks the role
  // permission checks (SC-049) before it reads or changes anything; the checks themselves are
  // tested role by role in src/service/permissions.test.ts.

  // FR-111's and FR-112's test cases in full: groups (SC-018), their members (SC-057) and their
  // projects (SC-058), and the tasks bob edits (SC-001), all through the REST API.
  const createGroup = async (creator: Seeded, name: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: as(creator),
      payload: { name },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }
  const setGroupRole = async (as_: Seeded, groupId: string, member: Seeded, role: string) => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}/members/${member.id}`,
      headers: as(as_),
      payload: { role },
    })
    expect(response.statusCode).toBe(200)
  }
  const addToGroup = async (as_: Seeded, groupId: string, projectId: string) => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}/projects/${projectId}`,
      headers: as(as_),
    })
    expect(response.statusCode).toBe(200)
  }
  const createTask = async (as_: Seeded, projectId: string, title: string): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${projectId}/tasks`,
      headers: as(as_, 'rest-api'),
      payload: { title },
    })
    expect(response.statusCode).toBe(201)
    return response.json<{ id: string }>().id
  }
  const rename = (as_: Seeded, taskId: string, title: string) =>
    app.inject({
      method: 'PATCH',
      url: `/api/tasks/${taskId}`,
      headers: as(as_, 'rest-api'),
      payload: { title },
    })
  const titleOf = async (taskId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}`,
      headers: as(alice, 'rest-api'),
    })
    expect(response.statusCode).toBe(200)
    return response.json<{ title: string }>().title
  }

  describe('TC-162: a group member holds the group role on every project in the group', () => {
    it("accepts bob's renaming of a task in Apollo and in Borealis, and refuses him their members", async () => {
      const platform = await createGroup(alice, 'Platform')
      const apollo = await create(alice, 'Apollo')
      const borealis = await create(alice, 'Borealis')
      await addToGroup(alice, platform, apollo)
      await addToGroup(alice, platform, borealis)
      await setGroupRole(alice, platform, bob, 'read-write')
      const a = await createTask(alice, apollo, 'A')
      const b = await createTask(alice, borealis, 'B')

      expect((await rename(bob, a, 'A by bob')).statusCode).toBe(200)
      expect((await rename(bob, b, 'B by bob')).statusCode).toBe(200)
      expect(await titleOf(a)).toBe('A by bob')
      expect(await titleOf(b)).toBe('B by bob')

      // Negative: bob cannot manage members of either project, since write is not admin.
      const carol = await seedAccount(x.db, { username: 'carol' })
      for (const p of [apollo, borealis]) {
        expect((await setRole(bob, p, carol, 'read-only')).statusCode).toBe(403)
        const removal = await app.inject({
          method: 'DELETE',
          url: `/api/projects/${p}/members/${alice.id}`,
          headers: as(bob),
        })
        expect(removal.statusCode).toBe(403)
      }
      // bob holds no direct role in either: his role there is the group's.
      for (const p of [apollo, borealis]) {
        const read = (await members(alice, p)).json<{ accountId: string }[]>()
        expect(read.map((m) => m.accountId)).toEqual([alice.id])
      }
    })
  })

  describe('TC-163: a removed group member loses the group role on its projects', () => {
    it("rejects bob's renaming of T and his reading of Apollo once alice removes him from Platform", async () => {
      const platform = await createGroup(alice, 'Platform')
      await setGroupRole(alice, platform, bob, 'read-write')
      const apollo = await create(alice, 'Apollo')
      await addToGroup(alice, platform, apollo)
      const t = await createTask(alice, apollo, 'Draft')

      // Step 1: alice removes bob from Platform.
      const removal = await app.inject({
        method: 'DELETE',
        url: `/api/groups/${platform}/members/${bob.id}`,
        headers: as(alice),
      })
      expect(removal.statusCode).toBe(204)

      // Step 2: bob tries to rename T, and to read Apollo.
      expect((await rename(bob, t, 'Mine')).statusCode).toBe(403)
      const read = await app.inject({
        method: 'GET',
        url: `/api/projects/${apollo}`,
        headers: as(bob, 'rest-api'),
      })
      expect(read.statusCode).toBe(403)
      expect(read.json()).toMatchObject({
        error: 'Not Visible',
        message: 'This project is not visible to you',
      })

      // Negative: T's title is still Draft.
      expect(await titleOf(t)).toBe('Draft')
    })
  })

  describe('TC-164: of a direct read role and a group write role, write applies', () => {
    it("accepts bob's renaming of T to Final and leaves his direct read-only role as it was", async () => {
      const apollo = await create(alice, 'Apollo')
      expect((await setRole(alice, apollo, bob, 'read-only')).statusCode).toBe(200)
      const platform = await createGroup(alice, 'Platform')
      await setGroupRole(alice, platform, bob, 'read-write')
      await addToGroup(alice, platform, apollo)
      const t = await createTask(alice, apollo, 'Draft')

      expect((await rename(bob, t, 'Final')).statusCode).toBe(200)
      expect(await titleOf(t)).toBe('Final')

      // Negative: bob's direct role is still read-only: it is not rewritten.
      const read = (await members(alice, apollo)).json<{ accountId: string; role: string }[]>()
      expect(read.find((m) => m.accountId === bob.id)?.role).toBe('read-only')
    })
  })
})
