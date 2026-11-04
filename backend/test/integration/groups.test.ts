import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, groupMembers, groups, projectMembers, projects } from '../../src/db/schema.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { GROUP_NAME_MAX_LENGTH, GroupService } from '../../src/service/groups.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { seedProject } from '../helpers/projects.ts'

// Group creation and listing (SC-018) and group membership (SC-057) against a real PostgreSQL:
// their rules, then the test cases of FR-121, FR-122, FR-159, FR-124, FR-125 and FR-160 through
// the REST API.

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
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  const fresh = (base: string) => `${base}-${randomUUID()}`

  beforeAll(async () => {
    x = await createTestDatabase()
    service = new GroupService(x.db, new AuditLogService(x.db))
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
      const broken = new GroupService(x.db, new BrokenAuditLog(x.db))
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
      expect(error.message).toBe('Only people with an account can see the groups')
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
      await refused(
        service.removeMember({ accountId: 'nobody', channel: 'ui' }, group.id, alice.id),
        'forbidden',
      )
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
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
          details: { accountId: bob.id, previousRole: role },
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
      await refused(
        service.leaveGroup({ accountId: randomUUID(), channel: 'ui' }, group.id),
        'forbidden',
      )
      expect(await roleRows(group.id)).toEqual({ [alice.id]: 'admin' })
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
})
