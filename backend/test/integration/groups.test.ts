import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import {
  auditLog,
  groupMembers,
  groupProjects,
  groups,
  projectMembers,
  projects,
} from '../../src/db/schema.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { GROUP_NAME_MAX_LENGTH, GroupService, groupRoles } from '../../src/service/groups.ts'
import { ProjectRoleService } from '../../src/service/project-roles.ts'
import { ProjectService } from '../../src/service/projects.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// Group creation and listing (SC-018), group membership (SC-057) and group project assignment
// (SC-058) against a real PostgreSQL: their rules, then the test cases of FR-121, FR-122, FR-159,
// FR-124, FR-125, FR-160 and FR-123 through the REST API.

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

describe('the group service', () => {
  let x: TestDatabase
  let service: GroupService
  let roles: ProjectRoleService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  const fresh = (base: string) => `${base}-${randomUUID()}`

  beforeAll(async () => {
    x = await createTestDatabase()
    const audit = new AuditLogService(x.db)
    roles = new ProjectRoleService(x.db, audit, groupRoles)
    service = new GroupService(x.db, audit, roles)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const membersOf = (groupId: string) =>
    x.db.select().from(groupMembers).where(eq(groupMembers.groupId, groupId))

  /** Each member's role in the group, by account id, so that the order does not matter. */
  const roleRows = async (groupId: string) =>
    Object.fromEntries((await membersOf(groupId)).map((m) => [m.accountId, m.role]))

  describe('createGroup', () => {
    it('creates the group and makes its creator its admin and only member', async () => {
      const name = fresh('Platform')
      const group = await service.createGroup(by(alice), { name })
      expect(group).toEqual({ id: expect.any(String), name })
      expect(await x.db.select().from(groups).where(eq(groups.id, group.id))).toMatchObject([
        { name, createdBy: alice.id },
      ])
      expect((await membersOf(group.id)).map((m) => [m.accountId, m.role])).toEqual([
        [alice.id, 'admin'],
      ])
    })

    it('lets a system admin create one too, and makes them its admin', async () => {
      const group = await service.createGroup(by(root), { name: fresh('Root') })
      expect((await membersOf(group.id)).map((m) => [m.accountId, m.role])).toEqual([
        [root.id, 'admin'],
      ])
    })

    it('trims the name and keeps it in one Unicode form', async () => {
      const base = fresh('Cafe')
      const group = await service.createGroup(by(alice), { name: `  ${base}é  ` })
      expect(group.name).toBe(`${base}é`)
    })

    it('takes a name of the longest length, counting each character as a person does', async () => {
      const name = 'é'.repeat(GROUP_NAME_MAX_LENGTH - 40) + '👩‍💻'.repeat(40)
      expect((await service.createGroup(by(alice), { name })).name).toBe(name)
    })

    it('refuses a name another group has, and creates nothing', async () => {
      const name = fresh('Twin')
      const first = await service.createGroup(by(alice), { name })
      const error = await refused(service.createGroup(by(bob), { name: ` ${name} ` }), 'conflict')
      expect(error.message).toBe(`A group named ${name} already exists`)
      const named = await x.db.select().from(groups).where(eq(groups.name, name))
      expect(named.map((g) => [g.id, g.createdBy])).toEqual([[first.id, alice.id]])
      expect(await x.db.select().from(auditLog).where(eq(auditLog.actorAccountId, bob.id))).toEqual(
        [],
      )
    })

    it('treats the same name typed in two Unicode forms as one name', async () => {
      const base = fresh('Cafe')
      await service.createGroup(by(alice), { name: `${base}\u00e9` })
      const error = await refused(
        service.createGroup(by(bob), { name: `${base}e\u0301` }),
        'conflict',
      )
      expect(error.message).toBe(`A group named ${base}\u00e9 already exists`)
    })

    it('lets only one of two concurrent creations of one name succeed', async () => {
      const name = fresh('Race')
      const results = await Promise.allSettled([
        service.createGroup(by(alice), { name }),
        service.createGroup(by(bob), { name }),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const reasons = results.flatMap((r) => (r.status === 'rejected' ? [r.reason] : []))
      expect(reasons).toEqual([expect.objectContaining({ name: 'ServiceError', kind: 'conflict' })])
      expect(await x.db.select().from(groups).where(eq(groups.name, name))).toHaveLength(1)
    })

    it('passes on a database failure that is not a name conflict', async () => {
      class BrokenAuditLog extends AuditLogService {
        override async record(): Promise<void> {
          throw new Error('audit log unavailable')
        }
      }
      const broken = new GroupService(x.db, new BrokenAuditLog(x.db), roles)
      const name = fresh('Broken')
      await expect(broken.createGroup(by(alice), { name })).rejects.toThrow('audit log unavailable')
      // The transaction is rolled back: no group without its entry in the audit log.
      expect(await x.db.select().from(groups).where(eq(groups.name, name))).toEqual([])
    })

    it.each([
      ['an empty name', '', 'A group name is required'],
      ['a name of spaces only', '   ', 'A group name is required'],
      [
        'a name that is too long',
        'x'.repeat(GROUP_NAME_MAX_LENGTH + 1),
        `A group name can have at most ${GROUP_NAME_MAX_LENGTH} characters`,
      ],
    ])('refuses %s and creates nothing', async (_, name, message) => {
      const before = await x.db.select().from(groups)
      const error = await refused(service.createGroup(by(alice), { name }), 'invalid')
      expect(error.message).toBe(message)
      expect(await x.db.select().from(groups)).toHaveLength(before.length)
    })

    it('refuses a caller who has no account, and creates nothing', async () => {
      const before = await x.db.select().from(groups)
      for (const accountId of [randomUUID(), 'nobody']) {
        const error = await refused(
          service.createGroup({ accountId, channel: 'ui' }, { name: fresh('Ghost') }),
          'forbidden',
        )
        expect(error.message).toBe('Only people with an account can create a group')
      }
      expect(await x.db.select().from(groups)).toHaveLength(before.length)
    })

    it('records the creation in the audit log, outside any project, with its channel', async () => {
      const name = fresh('Logged')
      const group = await service.createGroup(
        { accountId: alice.id, channel: 'rest-api' },
        { name },
      )
      const entries = await x.db.select().from(auditLog).where(eq(auditLog.subjectId, group.id))
      expect(entries).toMatchObject([
        {
          actorAccountId: alice.id,
          channels: ['rest-api'],
          projectId: null,
          action: 'group.created',
          subjectType: 'group',
          details: { name },
        },
      ])
    })
  })

  describe('listGroups', () => {
    it('shows every group to everyone, member or not, by name', async () => {
      const zeta = await service.createGroup(by(alice), { name: `zz-${randomUUID()}` })
      const alpha = await service.createGroup(by(bob), { name: `AA-${randomUUID()}` })
      const all = await x.db.select({ id: groups.id }).from(groups)
      for (const viewer of [alice, bob, root]) {
        const listed = await service.listGroups(by(viewer))
        expect(listed.map((g) => g.id).sort()).toEqual(all.map((g) => g.id).sort())
        const ids = listed.map((g) => g.id)
        expect(ids.indexOf(alpha.id)).toBeLessThan(ids.indexOf(zeta.id))
      }
      const carol = await seedAccount(x.db, { username: `carol-${randomUUID()}` })
      expect((await service.listGroups(by(carol))).map((g) => g.id)).toContain(zeta.id)
    })

    it('refuses a caller who has no account', async () => {
      for (const accountId of [randomUUID(), 'nobody']) {
        const error = await refused(service.listGroups({ accountId, channel: 'ui' }), 'forbidden')
        expect(error.message).toBe('Only people with an account can see the groups')
      }
    })
  })

  describe('listMembers', () => {
    it("shows a group's member its members, with their roles", async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Members') })
      expect(await service.listMembers(by(alice), group.id)).toEqual([
        { accountId: alice.id, username: 'alice', role: 'admin' },
      ])
    })

    it("refuses someone who is not the group's member, a system admin included", async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Closed') })
      for (const viewer of [bob, root]) {
        const error = await refused(service.listMembers(by(viewer), group.id), 'forbidden')
        expect(error.message).toBe("Only the group's members can see its members")
      }
    })

    it('refuses a caller who has no account before telling whether the group exists', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Ghostly') })
      for (const accountId of [randomUUID(), 'nobody']) {
        for (const groupId of [group.id, randomUUID()]) {
          const error = await refused(
            service.listMembers({ accountId, channel: 'ui' }, groupId),
            'forbidden',
          )
          expect(error.message).toBe('Only people with an account can see the groups')
        }
      }
    })

    it('answers a group that does not exist as not found', async () => {
      for (const groupId of [randomUUID(), 'platform']) {
        const error = await refused(service.listMembers(by(alice), groupId), 'not-found')
        expect(error.message).toBe('There is no such group')
      }
    })
  })

  describe('setMemberRole', () => {
    it('lets an admin add a person with each of the four roles, and change it', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Roles') })
      for (const role of ['read-only', 'contributor', 'read-write', 'admin'] as const) {
        expect(await service.setMemberRole(by(alice), group.id, bob.id, role)).toEqual({
          accountId: bob.id,
          username: 'bob',
          role,
        })
        expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin', [bob.id]: role })
      }
    })

    it('lets any member holding the admin role manage members, not only the creator', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Second admin') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'admin')
      await service.setMemberRole(by(bob), group.id, root.id, 'read-only')
      await service.setMemberRole(by(bob), group.id, alice.id, 'read-write')
      expect(await roleRows(group.id)).toEqual({
        [alice.id]: 'read-write',
        [bob.id]: 'admin',
        [root.id]: 'read-only',
      })
    })

    it('records each change in the audit log, outside any project, and none for no change', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Audited') })
      await service.setMemberRole(
        { accountId: alice.id, channel: 'rest-api' },
        group.id,
        bob.id,
        'read-only',
      )
      await service.setMemberRole(by(alice), group.id, bob.id, 'contributor')
      await service.setMemberRole(by(alice), group.id, bob.id, 'contributor')
      const entries = await x.db
        .select()
        .from(auditLog)
        .where(eq(auditLog.subjectId, group.id))
        .orderBy(auditLog.id)
      expect(
        entries.map((e) => [e.action, e.channels, e.projectId, e.subjectType, e.details]),
      ).toEqual([
        ['group.created', ['ui'], null, 'group', { name: expect.any(String) }],
        [
          'group.member-role-set',
          ['rest-api'],
          null,
          'group',
          { accountId: bob.id, username: 'bob', role: 'read-only', previousRole: null },
        ],
        [
          'group.member-role-set',
          ['ui'],
          null,
          'group',
          { accountId: bob.id, username: 'bob', role: 'contributor', previousRole: 'read-only' },
        ],
      ])
    })

    it('refuses a member who is not an admin, and someone who is not a member, a system admin included', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Admins only') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'read-write')
      for (const [who, target] of [
        [bob, root],
        [bob, bob],
        [root, bob],
      ] as const) {
        const error = await refused(
          service.setMemberRole(by(who), group.id, target.id, 'admin'),
          'forbidden',
        )
        expect(error.message).toBe("Only the group's admins can manage its members")
      }
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin', [bob.id]: 'read-write' })
    })

    it("refuses to take the admin role from the group's last admin", async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Last admin') })
      const error = await refused(
        service.setMemberRole(by(alice), group.id, alice.id, 'read-write'),
        'conflict',
      )
      expect(error.message).toBe('A group must keep at least one admin')
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
    })

    it('lets an admin step down once another admin is there', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Step down') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'admin')
      await service.setMemberRole(by(alice), group.id, alice.id, 'read-only')
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'read-only', [bob.id]: 'admin' })
    })

    it('answers setting the role a member already holds with the member, last admin included', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Same role') })
      expect(await service.setMemberRole(by(alice), group.id, alice.id, 'admin')).toEqual({
        accountId: alice.id,
        username: 'alice',
        role: 'admin',
      })
    })

    it('refuses a role that is not one of the four', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Bad role') })
      const error = await refused(
        service.setMemberRole(by(alice), group.id, bob.id, 'owner'),
        'invalid',
      )
      expect(error.message).toBe('A group role is one of read-only, contributor, read-write, admin')
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
    })

    it('refuses a person who has no account', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('No account') })
      for (const accountId of [randomUUID(), 'nobody']) {
        const error = await refused(
          service.setMemberRole(by(alice), group.id, accountId, 'read-only'),
          'not-found',
        )
        expect(error.message).toBe('There is no such account')
      }
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
    })

    it('answers a group that does not exist as not found', async () => {
      for (const groupId of [randomUUID(), 'platform']) {
        const error = await refused(
          service.setMemberRole(by(alice), groupId, bob.id, 'read-only'),
          'not-found',
        )
        expect(error.message).toBe('There is no such group')
      }
    })

    it('refuses a caller who has no account', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Ghost caller') })
      const error = await refused(
        service.setMemberRole(
          { accountId: randomUUID(), channel: 'ui' },
          group.id,
          bob.id,
          'admin',
        ),
        'forbidden',
      )
      expect(error.message).toBe("Only people with an account can change a group's members")
    })

    it('lets only one of two admins demote the other at once, so the group keeps an admin', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Demote race') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'admin')
      const results = await Promise.allSettled([
        service.setMemberRole(by(alice), group.id, bob.id, 'read-only'),
        service.setMemberRole(by(bob), group.id, alice.id, 'read-only'),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      const admins = (await membersOf(group.id)).filter((m) => m.role === 'admin')
      expect(admins).toHaveLength(1)
    })
  })

  describe('setMemberRoleByUsername', () => {
    it('adds the person with the username, matched regardless of case, with the role', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('By name') })
      expect(
        await service.setMemberRoleByUsername(by(alice), group.id, ' BOB ', 'contributor'),
      ).toEqual({ accountId: bob.id, username: 'bob', role: 'contributor' })
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin', [bob.id]: 'contributor' })
    })

    it('refuses a username no account has, and changes nothing', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('No such name') })
      const error = await refused(
        service.setMemberRoleByUsername(by(alice), group.id, 'nobody', 'read-only'),
        'not-found',
      )
      expect(error.message).toBe('There is no such account')
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
    })

    it("holds the same rules as by account id: only the group's admins, and its last admin kept", async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Same rules') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'read-write')
      await refused(
        service.setMemberRoleByUsername(by(bob), group.id, 'root', 'read-only'),
        'forbidden',
      )
      await refused(
        service.setMemberRoleByUsername(by(alice), group.id, 'alice', 'read-only'),
        'conflict',
      )
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin', [bob.id]: 'read-write' })
    })
  })

  describe('removeMember', () => {
    it('lets an admin take a member out of the group, and records it', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Remove') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'read-write')
      await service.removeMember(by(alice), group.id, bob.id)
      expect((await membersOf(group.id)).map((m) => m.accountId)).toEqual([alice.id])
      const [entry] = await x.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.subjectId, group.id), eq(auditLog.action, 'group.member-removed')))
      expect(entry).toMatchObject({
        actorAccountId: alice.id,
        projectId: null,
        subjectType: 'group',
        details: { accountId: bob.id, username: 'bob', previousRole: 'read-write' },
      })
    })

    it('lets an admin remove another admin, or themselves while another admin is there', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Remove admin') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'admin')
      await service.setMemberRole(by(alice), group.id, root.id, 'admin')
      await service.removeMember(by(alice), group.id, root.id)
      await service.removeMember(by(alice), group.id, alice.id)
      expect((await membersOf(group.id)).map((m) => [m.accountId, m.role])).toEqual([
        [bob.id, 'admin'],
      ])
    })

    it("refuses to remove the group's last admin, themselves included", async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Keep admin') })
      const error = await refused(service.removeMember(by(alice), group.id, alice.id), 'conflict')
      expect(error.message).toBe('A group must keep at least one admin')
      expect((await membersOf(group.id)).map((m) => m.accountId)).toEqual([alice.id])
    })

    it('refuses a member who is not an admin, and someone who is not a member', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Remove forbidden') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'read-write')
      for (const who of [bob, root]) {
        const error = await refused(service.removeMember(by(who), group.id, alice.id), 'forbidden')
        expect(error.message).toBe("Only the group's admins can manage its members")
      }
      expect(await membersOf(group.id)).toHaveLength(2)
    })

    it('answers a person who is not a member as not found', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Not member') })
      for (const accountId of [bob.id, randomUUID(), 'bob']) {
        const error = await refused(
          service.removeMember(by(alice), group.id, accountId),
          'not-found',
        )
        expect(error.message).toBe('There is no such member')
      }
    })

    it('answers a group that does not exist as not found', async () => {
      const error = await refused(
        service.removeMember(by(alice), randomUUID(), bob.id),
        'not-found',
      )
      expect(error.message).toBe('There is no such group')
    })

    it('refuses a caller who has no account', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Ghost remover') })
      const error = await refused(
        service.removeMember({ accountId: 'nobody', channel: 'ui' }, group.id, alice.id),
        'forbidden',
      )
      expect(error.message).toBe("Only people with an account can change a group's members")
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
    })
  })

  describe('removeMember, at once', () => {
    it('lets only one of two admins remove the other at once, so the group keeps an admin', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Remove race') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'admin')
      const results = await Promise.allSettled([
        service.removeMember(by(alice), group.id, bob.id),
        service.removeMember(by(bob), group.id, alice.id),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect((await membersOf(group.id)).filter((m) => m.role === 'admin')).toHaveLength(1)
    })
  })

  describe('leaveGroup', () => {
    it.each(['read-only', 'contributor', 'read-write'] as const)(
      'lets a member with the %s role leave, and records it',
      async (role) => {
        const group = await service.createGroup(by(alice), { name: fresh('Leave') })
        await service.setMemberRole(by(alice), group.id, bob.id, role)
        await service.leaveGroup({ accountId: bob.id, channel: 'mcp' }, group.id)
        expect((await membersOf(group.id)).map((m) => m.accountId)).toEqual([alice.id])
        const [entry] = await x.db
          .select()
          .from(auditLog)
          .where(and(eq(auditLog.subjectId, group.id), eq(auditLog.action, 'group.member-left')))
        expect(entry).toMatchObject({
          actorAccountId: bob.id,
          channels: ['mcp'],
          projectId: null,
          details: { accountId: bob.id, username: 'bob', previousRole: role },
        })
      },
    )

    it('lets an admin leave while another admin is there', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Admin leaves') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'admin')
      await service.leaveGroup(by(alice), group.id)
      expect((await membersOf(group.id)).map((m) => [m.accountId, m.role])).toEqual([
        [bob.id, 'admin'],
      ])
    })

    it("refuses the group's last admin leaving, and changes nothing", async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Stay') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'read-write')
      const error = await refused(service.leaveGroup(by(alice), group.id), 'conflict')
      expect(error.message).toBe("The group's last admin cannot leave it")
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin', [bob.id]: 'read-write' })
    })

    it('lets only one of two admins leave at once, so the group keeps an admin', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Leave race') })
      await service.setMemberRole(by(alice), group.id, bob.id, 'admin')
      const results = await Promise.allSettled([
        service.leaveGroup(by(alice), group.id),
        service.leaveGroup(by(bob), group.id),
      ])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect((await membersOf(group.id)).filter((m) => m.role === 'admin')).toHaveLength(1)
    })

    it("refuses a non-member before locking the group's admins", async () => {
      const group = await service.createGroup(by(alice), { name: fresh('No hold-up') })
      // Hold alice's admin row locked in another transaction; a non-member's leave must not wait.
      await x.db.transaction(async (tx) => {
        await tx.select().from(groupMembers).where(eq(groupMembers.groupId, group.id)).for('update')
        const error = await refused(service.leaveGroup(by(bob), group.id), 'not-found')
        expect(error.message).toBe('You are not a member of this group')
      })
    })

    it('answers someone who is not a member as not found', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Outsider') })
      const error = await refused(service.leaveGroup(by(bob), group.id), 'not-found')
      expect(error.message).toBe('You are not a member of this group')
    })

    it('answers a group that does not exist as not found', async () => {
      for (const groupId of [randomUUID(), 'platform']) {
        const error = await refused(service.leaveGroup(by(bob), groupId), 'not-found')
        expect(error.message).toBe('There is no such group')
      }
    })

    it('refuses a caller who has no account', async () => {
      const group = await service.createGroup(by(alice), { name: fresh('Ghost leaver') })
      const error = await refused(
        service.leaveGroup({ accountId: randomUUID(), channel: 'ui' }, group.id),
        'forbidden',
      )
      expect(error.message).toBe("Only people with an account can change a group's members")
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
    })
  })
})

describe('group project assignment', () => {
  let x: TestDatabase
  let audit: AuditLogService
  let roles: ProjectRoleService
  let service: GroupService
  let projectService: ProjectService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded
  const fresh = (base: string) => `${base}-${randomUUID()}`

  beforeAll(async () => {
    x = await createTestDatabase()
    audit = new AuditLogService(x.db)
    roles = new ProjectRoleService(x.db, audit, groupRoles)
    service = new GroupService(x.db, audit, roles)
    projectService = new ProjectService(x.db, audit, roles, service)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  /** A new group named after `base`, of which `admin` is the admin. */
  const group = (admin: Seeded, base = 'Platform') =>
    service.createGroup(by(admin), { name: fresh(base) })
  /** A new project named after `base`, of which `admin` is the only admin. */
  const project = async (admin: Seeded, base = 'Apollo') => {
    const name = fresh(base)
    return { id: await seedProject(x.db, admin, name), name }
  }
  /** The ids of the projects in the group, straight from the database. */
  const projectsIn = async (groupId: string) =>
    (await x.db.select().from(groupProjects).where(eq(groupProjects.groupId, groupId))).map(
      (row) => row.projectId,
    )
  /** The audit log's entries of projects added to the group. */
  const additionsTo = (groupId: string) =>
    x.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.subjectId, groupId), eq(auditLog.action, 'group.project-added')))

  describe('addProject', () => {
    it("lets the project's admin add it to a group they are not a member of, and records it", async () => {
      const platform = await group(bob)
      const apollo = await project(alice)
      expect(await service.addProject(by(alice), platform.id, apollo.id)).toEqual(apollo)
      expect(await projectsIn(platform.id)).toEqual([apollo.id])
      expect(await additionsTo(platform.id)).toMatchObject([
        {
          actorAccountId: alice.id,
          subjectType: 'group',
          projectId: apollo.id,
          details: { projectName: apollo.name },
        },
      ])
      // Adding it makes alice no member of the group.
      expect(
        await x.db.select().from(groupMembers).where(eq(groupMembers.groupId, platform.id)),
      ).toEqual([{ groupId: platform.id, accountId: bob.id, role: 'admin' }])
    })

    it("gives the group's members their group role on the project (FR-111)", async () => {
      const platform = await group(bob)
      await service.setMemberRole(by(bob), platform.id, carol.id, 'contributor')
      const apollo = await project(alice)
      expect(await roles.roleOf(carol.id, apollo.id)).toBeUndefined()
      await service.addProject(by(alice), platform.id, apollo.id)
      expect(await roles.roleOf(carol.id, apollo.id)).toBe('contributor')
      expect(await roles.roleOf(bob.id, apollo.id)).toBe('admin')
      // alice's own role is unchanged.
      expect(await roles.roleOf(alice.id, apollo.id)).toBe('admin')
    })

    it('leaves a project already in the group as it is, and records nothing more', async () => {
      const platform = await group(alice)
      const apollo = await project(alice)
      await service.addProject(by(alice), platform.id, apollo.id)
      expect(await service.addProject(by(alice), platform.id, apollo.id)).toEqual(apollo)
      expect(await projectsIn(platform.id)).toEqual([apollo.id])
      expect(await additionsTo(platform.id)).toHaveLength(1)
    })

    it('lets someone who holds the admin role on the project through a group add it too', async () => {
      const first = await group(alice)
      const apollo = await project(alice)
      await service.addProject(by(alice), first.id, apollo.id)
      await service.setMemberRole(by(alice), first.id, bob.id, 'admin')
      const second = await group(carol)
      await service.addProject(by(bob), second.id, apollo.id)
      expect(await projectsIn(second.id)).toEqual([apollo.id])
    })

    it.each(['read-only', 'contributor', 'read-write'] as const)(
      'refuses a project member with the %s role, and adds nothing',
      async (role) => {
        const platform = await group(bob)
        const apollo = await project(alice)
        await grantRole(x.db, bob, apollo.id, role)
        const error = await refused(
          service.addProject(by(bob), platform.id, apollo.id),
          'forbidden',
        )
        expect(error.message).toBe(
          "Only the project's admins can manage its members, roles, repositories and settings",
        )
        expect(await projectsIn(platform.id)).toEqual([])
        expect(await roles.roleOf(bob.id, apollo.id)).toBe(role)
      },
    )

    it("refuses the group's own admin who holds no role in the project as not visible", async () => {
      const platform = await group(bob)
      const apollo = await project(alice)
      await refused(service.addProject(by(bob), platform.id, apollo.id), 'not-visible')
      // A system admin holds no role in it either (FR-017).
      await refused(service.addProject(by(root), platform.id, apollo.id), 'not-visible')
      // Nor does a caller whose id is not an account's.
      const nobody = { accountId: 'nobody', channel: 'ui' } as const
      await refused(service.addProject(nobody, platform.id, apollo.id), 'not-visible')
      expect(await projectsIn(platform.id)).toEqual([])
    })

    it('answers a project that does not exist as not visible, as one the caller cannot see', async () => {
      const platform = await group(alice)
      for (const projectId of [randomUUID(), 'not-a-uuid']) {
        const error = await refused(
          service.addProject(by(alice), platform.id, projectId),
          'not-visible',
        )
        expect(error.message).toBe('This project is not visible to you')
      }
    })

    it('refuses a group that does not exist as not found', async () => {
      const apollo = await project(alice)
      for (const groupId of [randomUUID(), 'not-a-uuid']) {
        const error = await refused(service.addProject(by(alice), groupId, apollo.id), 'not-found')
        expect(error.message).toBe('There is no such group')
      }
    })

    it("waits for a demotion of the project's admin in progress, then refuses them", async () => {
      const platform = await group(bob)
      const apollo = await project(alice)
      let demoted!: () => void
      const held = new Promise<void>((resolve) => (demoted = resolve))
      let started!: () => void
      const demoting = new Promise<void>((resolve) => (started = resolve))
      // A demotion of alice, not yet committed while she tries to add Apollo.
      const demotion = x.db.transaction(async (tx) => {
        await tx
          .update(projectMembers)
          .set({ role: 'read-write' })
          .where(
            and(eq(projectMembers.projectId, apollo.id), eq(projectMembers.accountId, alice.id)),
          )
        started()
        await held
      })
      await demoting
      const attempt = service.addProject(by(alice), platform.id, apollo.id)
      // Long enough for the attempt to reach its lock, which the demotion holds.
      await new Promise((resolve) => setTimeout(resolve, 200))
      demoted()
      await demotion
      const error = await refused(attempt, 'forbidden')
      expect(error.message).toBe(
        "Only the project's admins can manage its members, roles, repositories and settings",
      )
      expect(await projectsIn(platform.id)).toEqual([])
    })

    it('adds nothing when the audit log cannot be written', async () => {
      class BrokenAuditLog extends AuditLogService {
        override async record(): Promise<void> {
          throw new Error('audit log unavailable')
        }
      }
      const broken = new GroupService(x.db, new BrokenAuditLog(x.db), roles)
      const platform = await group(alice)
      const apollo = await project(alice)
      await expect(broken.addProject(by(alice), platform.id, apollo.id)).rejects.toThrow(
        'audit log unavailable',
      )
      expect(await projectsIn(platform.id)).toEqual([])
    })
  })

  describe('a new project added to groups as it is created', () => {
    it('lets anyone add their new project to any groups, none of which they are a member of', async () => {
      const [one, two] = [await group(alice, 'One'), await group(bob, 'Two')]
      const name = fresh('Delta')
      // The same group twice counts once.
      const delta = await projectService.createProject(by(carol), {
        name,
        groupIds: [one.id, two.id, one.id],
      })
      expect(await projectsIn(one.id)).toEqual([delta.id])
      expect(await projectsIn(two.id)).toEqual([delta.id])
      expect(await additionsTo(one.id)).toMatchObject([
        { actorAccountId: carol.id, projectId: delta.id, details: { projectName: name } },
      ])
      expect(await additionsTo(two.id)).toHaveLength(1)
      // carol is its admin, and becomes a member of neither group.
      expect(await roles.roleOf(carol.id, delta.id)).toBe('admin')
      expect(await service.listMembers(by(alice), one.id)).toEqual([
        { accountId: alice.id, username: 'alice', role: 'admin' },
      ])
      // The groups' members hold their group roles on it.
      expect(await roles.roleOf(alice.id, delta.id)).toBe('admin')
      expect(await roles.roleOf(bob.id, delta.id)).toBe('admin')
    })

    it('adds the project to no group when none is given', async () => {
      const platform = await group(alice)
      for (const groupIds of [undefined, []]) {
        await projectService.createProject(by(carol), {
          name: fresh('Plain'),
          ...(groupIds ? { groupIds } : {}),
        })
      }
      expect(await projectsIn(platform.id)).toEqual([])
    })

    it.each([
      ['a group that does not exist', () => randomUUID()],
      ['a group id that is not a UUID', () => 'not-a-uuid'],
    ])('refuses %s as not found, and creates nothing', async (_, missing) => {
      const platform = await group(alice)
      const name = fresh('Lost')
      const error = await refused(
        projectService.createProject(by(carol), { name, groupIds: [platform.id, missing()] }),
        'not-found',
      )
      expect(error.message).toBe('There is no such group')
      expect(await x.db.select().from(projects).where(eq(projects.name, name))).toEqual([])
      expect(await projectsIn(platform.id)).toEqual([])
    })
  })

  describe('listProjects', () => {
    it("shows a group's members all of its projects, by name", async () => {
      const platform = await group(alice)
      await service.setMemberRole(by(alice), platform.id, carol.id, 'read-only')
      const zulu = await project(bob, 'Zulu')
      const apollo = await project(alice, 'Apollo')
      await service.addProject(by(bob), platform.id, zulu.id)
      await service.addProject(by(alice), platform.id, apollo.id)
      expect(await service.listProjects(by(carol), platform.id)).toEqual([apollo, zulu])
    })

    it('shows someone who is not a member only the projects they can see themselves', async () => {
      const platform = await group(alice)
      const own = await project(bob, 'Own')
      const hidden = await project(alice, 'Hidden')
      await service.addProject(by(bob), platform.id, own.id)
      await service.addProject(by(alice), platform.id, hidden.id)
      expect(await service.listProjects(by(bob), platform.id)).toEqual([own])
      expect(await service.listProjects(by(root), platform.id)).toEqual([])
    })

    it('lists nothing for a group with no projects', async () => {
      const platform = await group(alice)
      expect(await service.listProjects(by(alice), platform.id)).toEqual([])
    })

    it('refuses a group that does not exist as not found', async () => {
      for (const groupId of [randomUUID(), 'not-a-uuid']) {
        const error = await refused(service.listProjects(by(alice), groupId), 'not-found')
        expect(error.message).toBe('There is no such group')
      }
    })

    it('refuses a caller who has no account', async () => {
      const platform = await group(alice)
      for (const accountId of [randomUUID(), 'nobody']) {
        const caller = { accountId, channel: 'ui' } as const
        const error = await refused(service.listProjects(caller, platform.id), 'forbidden')
        expect(error.message).toBe('Only people with an account can see the groups')
      }
    })
  })

  describe('the roles a group gives on its projects (FR-111)', () => {
    it('gives each member their group role, for as long as they are a member', async () => {
      const platform = await group(alice)
      const apollo = await project(alice)
      await service.addProject(by(alice), platform.id, apollo.id)
      await service.setMemberRole(by(alice), platform.id, carol.id, 'read-write')
      expect(await groupRoles.rolesThroughGroups(x.db, carol.id, apollo.id)).toEqual(['read-write'])
      expect(await roles.readableProjects(carol.id)).toContain(apollo.id)
      await service.removeMember(by(alice), platform.id, carol.id)
      expect(await groupRoles.rolesThroughGroups(x.db, carol.id, apollo.id)).toEqual([])
      expect(await roles.roleOf(carol.id, apollo.id)).toBeUndefined()
    })

    it('applies the highest of the roles held through several groups and directly (FR-112)', async () => {
      const [one, two] = [await group(alice, 'One'), await group(alice, 'Two')]
      const apollo = await project(alice)
      await service.addProject(by(alice), one.id, apollo.id)
      await service.addProject(by(alice), two.id, apollo.id)
      await service.setMemberRole(by(alice), one.id, carol.id, 'read-only')
      await service.setMemberRole(by(alice), two.id, carol.id, 'read-write')
      await grantRole(x.db, carol, apollo.id, 'contributor')
      expect((await groupRoles.rolesThroughGroups(x.db, carol.id, apollo.id)).sort()).toEqual([
        'read-only',
        'read-write',
      ])
      expect(await roles.roleOf(carol.id, apollo.id)).toBe('read-write')
      const all = await groupRoles.allRolesThroughGroups(x.db, carol.id)
      expect(
        all
          .filter((r) => r.projectId === apollo.id)
          .map((r) => r.role)
          .sort(),
      ).toEqual(['read-only', 'read-write'])
    })

    it('gives a member nothing on a project of the group they are not in, or for ids that are not UUIDs', async () => {
      const platform = await group(alice)
      const apollo = await project(alice)
      await service.addProject(by(alice), platform.id, apollo.id)
      expect(await groupRoles.rolesThroughGroups(x.db, bob.id, apollo.id)).toEqual([])
      expect(await groupRoles.rolesThroughGroups(x.db, 'nobody', apollo.id)).toEqual([])
      expect(await groupRoles.rolesThroughGroups(x.db, bob.id, 'nothing')).toEqual([])
      expect(await groupRoles.allRolesThroughGroups(x.db, 'nobody')).toEqual([])
    })
  })
})

describe('test cases through the REST API', () => {
  // Each test case starts from its own fresh test deployment, as the test cases ask.
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const create = (account: Seeded, name: string) =>
    app.inject({ method: 'POST', url: '/api/groups', headers: as(account), payload: { name } })
  const list = (account: Seeded) =>
    app.inject({ method: 'GET', url: '/api/groups', headers: as(account) })

  describe('TC-180: anyone logged in creates a group', () => {
    it("lets erin, with no role anywhere and not a system admin, create and then list Erin's group", async () => {
      const erin = await seedAccount(x.db, { username: 'erin' })
      const created = await create(erin, "Erin's group")
      expect(created.statusCode).toBe(201)

      const listed = await list(erin)
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual([{ id: created.json().id, name: "Erin's group" }])

      // Negative: no project is created or changed.
      expect(await x.db.select().from(projects)).toEqual([])
      expect(await x.db.select().from(projectMembers)).toEqual([])
      expect((await x.db.select().from(auditLog)).map((e) => e.action)).toEqual(['group.created'])
    })
  })

  describe('TC-181: a non-member sees every group', () => {
    it('shows dave Platform, created by alice, and gives dave no role on any project', async () => {
      const alice = await seedAccount(x.db, { username: 'alice' })
      const dave = await seedAccount(x.db, { username: 'dave' })
      // A project of alice's, to show that seeing her group gives dave no role on it. Putting
      // projects into groups is SC-058's; until it is done, no group has projects.
      const project = await seedProject(x.db, alice, 'Platform service')
      const created = await create(alice, 'Platform')
      expect(created.statusCode).toBe(201)

      const listed = await list(dave)
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual([{ id: created.json().id, name: 'Platform' }])

      // Negative: seeing the group gives dave no role on any project.
      const services = createServices(x.db)
      expect(await services.projectRoles.roleOf(dave.id, project)).toBeUndefined()
      expect(
        (await app.inject({ method: 'GET', url: '/api/projects', headers: as(dave) })).json(),
      ).toEqual([])
      expect(
        await x.db.select().from(groupMembers).where(eq(groupMembers.accountId, dave.id)),
      ).toEqual([])
    })
  })

  describe("TC-231: a group's creator becomes its admin", () => {
    it("makes erin admin of Erin's group, its only member", async () => {
      const erin = await seedAccount(x.db, { username: 'erin' })
      const created = await create(erin, "Erin's group")
      const { id } = created.json<{ id: string }>()

      const members = await app.inject({
        method: 'GET',
        url: `/api/groups/${id}/members`,
        headers: as(erin),
      })
      expect(members.statusCode).toBe(200)
      // erin is its admin, and its only member: root is given no role in it.
      expect(members.json()).toEqual([{ accountId: erin.id, username: 'erin', role: 'admin' }])
      expect(
        await x.db.select().from(groupMembers).where(eq(groupMembers.accountId, root.id)),
      ).toEqual([])
    })
  })
  const members = (account: Seeded, groupId: string) =>
    app.inject({ method: 'GET', url: `/api/groups/${groupId}/members`, headers: as(account) })
  const setRole = (account: Seeded, groupId: string, target: Seeded, role: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}/members/${target.id}`,
      headers: as(account),
      payload: { role },
    })

  describe('TC-185: a group admin adds a member, changes their role and removes them', () => {
    it('lets alice add bob to Platform with read, change it to contributor, then remove him', async () => {
      const alice = await seedAccount(x.db, { username: 'alice' })
      const bob = await seedAccount(x.db, { username: 'bob' })
      const { id } = (await create(alice, 'Platform')).json<{ id: string }>()
      const aliceAdmin = { accountId: alice.id, username: 'alice', role: 'admin' }
      // Before step 1, bob is not a member.
      expect((await members(alice, id)).json()).toEqual([aliceAdmin])

      // Step 1: add bob with the read role; read the members.
      expect((await setRole(alice, id, bob, 'read-only')).statusCode).toBe(200)
      let read = await members(alice, id)
      expect(read.statusCode).toBe(200)
      expect(read.json()).toEqual([
        aliceAdmin,
        { accountId: bob.id, username: 'bob', role: 'read-only' },
      ])

      // Step 2: change bob's role to contributor; read it.
      expect((await setRole(alice, id, bob, 'contributor')).statusCode).toBe(200)
      read = await members(alice, id)
      expect(read.json()).toEqual([
        aliceAdmin,
        { accountId: bob.id, username: 'bob', role: 'contributor' },
      ])

      // Step 3: remove bob; read the members.
      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/groups/${id}/members/${bob.id}`,
        headers: as(alice),
      })
      expect(removed.statusCode).toBe(204)
      read = await members(alice, id)
      // bob is not a member, and alice stays the group's admin throughout.
      expect(read.json()).toEqual([aliceAdmin])
    })
  })

  describe('TC-186: a member leaves a group', () => {
    it('lets bob, a member of Platform with read, leave it', async () => {
      const alice = await seedAccount(x.db, { username: 'alice' })
      const bob = await seedAccount(x.db, { username: 'bob' })
      const { id } = (await create(alice, 'Platform')).json<{ id: string }>()
      expect((await setRole(alice, id, bob, 'read-only')).statusCode).toBe(200)

      // Step 1: as bob, leave Platform.
      const left = await app.inject({
        method: 'POST',
        url: `/api/groups/${id}/leave`,
        headers: as(bob),
      })
      expect(left.statusCode).toBe(204)

      // Step 2: read Platform's members. bob is not a member; alice is still a member and admin.
      const read = await members(alice, id)
      expect(read.statusCode).toBe(200)
      expect(read.json()).toEqual([{ accountId: alice.id, username: 'alice', role: 'admin' }])
    })
  })

  describe("TC-232: a group's last admin cannot leave it", () => {
    it('rejects alice, the only admin of Platform, leaving it, and leaves bob as he was', async () => {
      const alice = await seedAccount(x.db, { username: 'alice' })
      const bob = await seedAccount(x.db, { username: 'bob' })
      const { id } = (await create(alice, 'Platform')).json<{ id: string }>()
      expect((await setRole(alice, id, bob, 'read-write')).statusCode).toBe(200)

      // Step 1: as alice, try to leave Platform. The attempt is rejected.
      const attempt = await app.inject({
        method: 'POST',
        url: `/api/groups/${id}/leave`,
        headers: as(alice),
      })
      expect(attempt.statusCode).toBe(409)
      expect(attempt.json().message).toBe("The group's last admin cannot leave it")

      // Step 2: read Platform's members. alice is still a member and admin; bob's role is
      // unchanged, so bob is not made admin as a side effect.
      const read = await members(alice, id)
      expect(read.json()).toEqual([
        { accountId: alice.id, username: 'alice', role: 'admin' },
        { accountId: bob.id, username: 'bob', role: 'read-write' },
      ])
    })
  })

  // The test cases of FR-123 (SC-058).
  const createProject = (account: Seeded, name: string, groupIds?: string[]) =>
    app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: as(account),
      payload: { name, ...(groupIds ? { groupIds } : {}) },
    })
  const addProject = (account: Seeded, groupId: string, projectId: string) =>
    app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}/projects/${projectId}`,
      headers: as(account),
    })
  const projectsOf = (account: Seeded, groupId: string) =>
    app.inject({ method: 'GET', url: `/api/groups/${groupId}/projects`, headers: as(account) })
  const projectMembersOf = (account: Seeded, projectId: string) =>
    app.inject({ method: 'GET', url: `/api/projects/${projectId}/members`, headers: as(account) })

  describe('TC-182: anyone adds a new project to a group', () => {
    it('lets dave, not a member of Platform, create Delta and add it to Platform', async () => {
      const alice = await seedAccount(x.db, { username: 'alice' })
      const dave = await seedAccount(x.db, { username: 'dave' })
      const platform = (await create(alice, 'Platform')).json<{ id: string }>()

      // Step 1: as dave, create project Delta and add it to Platform.
      const created = await createProject(dave, 'Delta', [platform.id])
      expect(created.statusCode).toBe(201)
      const delta = created.json<{ id: string; name: string }>()
      expect(delta.name).toBe('Delta')

      // Step 2: list Platform's projects. Delta is in Platform.
      const listed = await projectsOf(alice, platform.id)
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual([delta])

      // Negative: dave does not become a member of Platform.
      expect((await members(alice, platform.id)).json()).toEqual([
        { accountId: alice.id, username: 'alice', role: 'admin' },
      ])
    })
  })

  describe("TC-183: a project's admin adds the existing project to a group", () => {
    it('lets alice, admin of Apollo and not a member of Platform, add Apollo to it', async () => {
      const alice = await seedAccount(x.db, { username: 'alice' })
      const bob = await seedAccount(x.db, { username: 'bob' })
      const platform = (await create(bob, 'Platform')).json<{ id: string }>()
      const apollo = (await createProject(alice, 'Apollo')).json<{ id: string; name: string }>()
      const aliceAdmin = [{ accountId: alice.id, username: 'alice', role: 'admin' }]
      expect((await projectMembersOf(alice, apollo.id)).json()).toEqual(aliceAdmin)

      // Step 1: as alice, add Apollo to Platform.
      const added = await addProject(alice, platform.id, apollo.id)
      expect(added.statusCode).toBe(200)
      expect(added.json()).toEqual(apollo)

      // Step 2: list Platform's projects. Apollo is in Platform.
      const listed = await projectsOf(bob, platform.id)
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual([apollo])

      // Negative: alice's role in Apollo is unchanged.
      expect((await projectMembersOf(alice, apollo.id)).json()).toEqual(aliceAdmin)
      expect(await createServices(x.db).projectRoles.roleOf(alice.id, apollo.id)).toBe('admin')
    })
  })

  describe('TC-184: someone who is not its admin cannot add an existing project to a group', () => {
    it('rejects bob, read-write on Apollo, adding Apollo to Platform', async () => {
      const alice = await seedAccount(x.db, { username: 'alice' })
      const bob = await seedAccount(x.db, { username: 'bob' })
      const platform = (await create(bob, 'Platform')).json<{ id: string }>()
      const apollo = (await createProject(alice, 'Apollo')).json<{ id: string }>()
      const given = await app.inject({
        method: 'PUT',
        url: `/api/projects/${apollo.id}/members/${bob.id}`,
        headers: as(alice),
        payload: { role: 'read-write' },
      })
      expect(given.statusCode).toBe(200)

      // Step 1: as bob, try to add Apollo to Platform. The attempt is rejected.
      const attempt = await addProject(bob, platform.id, apollo.id)
      expect(attempt.statusCode).toBe(403)

      // Step 2: list Platform's projects. Apollo is not in Platform.
      const listed = await projectsOf(bob, platform.id)
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual([])
      expect(await x.db.select().from(groupProjects)).toEqual([])

      // Negative: Platform's members get no role on Apollo: bob, its only member, still holds
      // read-write there, not the admin role he holds in Platform.
      expect(await createServices(x.db).projectRoles.roleOf(bob.id, apollo.id)).toBe('read-write')
    })
  })
})
