import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
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

// Group creation and listing (SC-018) against a real PostgreSQL: its rules, then the test cases of
// FR-121, FR-122 and FR-159 through the REST API.

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

    it('lets two groups have the same name, since nothing asks names to differ', async () => {
      const name = fresh('Twin')
      const first = await service.createGroup(by(alice), { name })
      const second = await service.createGroup(by(bob), { name })
      expect(second.id).not.toBe(first.id)
      expect((await service.listGroups(by(alice))).filter((g) => g.name === name)).toHaveLength(2)
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
      const error = await refused(
        service.listMembers({ accountId: 'nobody', channel: 'ui' }, group.id),
        'forbidden',
      )
      expect(error.message).toBe("Only the group's members can see its members")
    })

    it('answers a group that does not exist as not found', async () => {
      for (const groupId of [randomUUID(), 'platform']) {
        const error = await refused(service.listMembers(by(alice), groupId), 'not-found')
        expect(error.message).toBe('There is no such group')
      }
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
})
