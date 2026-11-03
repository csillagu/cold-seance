import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, projectMembers, projects } from '../../src/db/schema.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { ProjectRoleService } from '../../src/service/project-roles.ts'
import { PROJECT_NAME_MAX_LENGTH, ProjectService } from '../../src/service/projects.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'

// Project creation (SC-017) against a real PostgreSQL: its rules, then the test cases of FR-119
// and FR-158 through the REST API.

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

describe('the project service', () => {
  let x: TestDatabase
  let roles: ProjectRoleService
  let service: ProjectService
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  const fresh = (base: string) => `${base}-${randomUUID()}`

  beforeAll(async () => {
    x = await createTestDatabase()
    const audit = new AuditLogService(x.db)
    roles = new ProjectRoleService(x.db, audit)
    service = new ProjectService(x.db, audit, roles)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const stored = (id: string) => x.db.select().from(projects).where(eq(projects.id, id))

  describe('createProject', () => {
    it('creates the project and makes its creator its admin, and nobody else anything', async () => {
      const name = fresh('Apollo')
      const project = await service.createProject(by(alice), { name })
      expect(project).toEqual({ id: expect.any(String), name })
      expect(await stored(project.id)).toMatchObject([{ name, createdBy: alice.id }])
      expect(await roles.roleOf(alice.id, project.id)).toBe('admin')
      const members = await x.db
        .select()
        .from(projectMembers)
        .where(eq(projectMembers.projectId, project.id))
      expect(members.map((m) => [m.accountId, m.role])).toEqual([[alice.id, 'admin']])
    })

    it('lets a system admin create one too, and makes them its admin', async () => {
      const project = await service.createProject(by(root), { name: fresh('Root') })
      expect(await roles.roleOf(root.id, project.id)).toBe('admin')
    })

    it('trims the name and keeps it in one Unicode form', async () => {
      const base = fresh('Cafe')
      const project = await service.createProject(by(alice), {
        name: `  ${base}́  `,
      })
      expect(project.name).toBe(`${base}́`.normalize('NFC'))
    })

    it.each([
      ['an empty name', '', 'A project name is required'],
      ['a name of spaces only', '   ', 'A project name is required'],
      [
        'a name that is too long',
        'x'.repeat(PROJECT_NAME_MAX_LENGTH + 1),
        `A project name can have at most ${PROJECT_NAME_MAX_LENGTH} characters`,
      ],
    ])('refuses %s and creates nothing', async (_, name, message) => {
      const owner = await seedAccount(x.db, { username: fresh('owner') })
      const error = await refused(service.createProject(by(owner), { name }), 'invalid')
      expect(error.message).toBe(message)
      expect(await service.listProjects(by(owner))).toEqual([])
    })

    it('takes a name of the longest length, counting each character as a person does', async () => {
      const name = 'é'.repeat(PROJECT_NAME_MAX_LENGTH - 40) + '👩‍💻'.repeat(40)
      const project = await service.createProject(by(alice), { name })
      expect(project.name).toBe(name)
    })

    it('refuses a caller who has no account', async () => {
      for (const accountId of [randomUUID(), 'nobody']) {
        const error = await refused(
          service.createProject({ accountId, channel: 'ui' }, { name: fresh('Ghost') }),
          'forbidden',
        )
        expect(error.message).toBe('Only people with an account can create a project')
      }
    })

    it('records the creation in the project’s part of the audit log', async () => {
      const name = fresh('Logged')
      const project = await service.createProject(
        { accountId: bob.id, channel: 'rest-api' },
        {
          name,
        },
      )
      const entries = await x.db.select().from(auditLog).where(eq(auditLog.projectId, project.id))
      expect(
        entries.map((e) => [e.action, e.actorAccountId, e.channels, e.subjectId, e.details]),
      ).toEqual([['project.created', bob.id, ['rest-api'], project.id, { name }]])
    })

    it('creates neither the project nor the role when the audit log cannot be written', async () => {
      class UnavailableAuditLog extends AuditLogService {
        override async record(): Promise<void> {
          throw new Error('the audit log is not available')
        }
      }
      const owner = await seedAccount(x.db, { username: fresh('owner') })
      const failing = new ProjectService(x.db, new UnavailableAuditLog(x.db), roles)
      await expect(failing.createProject(by(owner), { name: fresh('Lost') })).rejects.toThrow(
        'the audit log is not available',
      )
      expect(await x.db.select().from(projects).where(eq(projects.createdBy, owner.id))).toEqual([])
      expect(
        await x.db.select().from(projectMembers).where(eq(projectMembers.accountId, owner.id)),
      ).toEqual([])
    })
  })

  describe('getProject', () => {
    it('answers the project to anyone holding a role in it, and not-visible to anyone else', async () => {
      const project = await service.createProject(by(alice), { name: fresh('Seen') })
      expect(await service.getProject(by(alice), project.id)).toEqual(project)
      await roles.setRole(by(alice), project.id, bob.id, 'read-only')
      expect(await service.getProject(by(bob), project.id)).toEqual(project)
      for (const caller of [by(root), { accountId: 'nobody', channel: 'ui' } as const]) {
        const error = await refused(service.getProject(caller, project.id), 'not-visible')
        expect(error.message).toBe('This project is not visible to you')
      }
      await refused(service.getProject(by(alice), randomUUID()), 'not-visible')
      await refused(service.getProject(by(alice), 'apollo'), 'not-visible')
    })
  })

  describe('listProjects', () => {
    it('lists by name the projects the caller holds a role in, and no others', async () => {
      const owner = await seedAccount(x.db, { username: fresh('owner') })
      const zeta = await service.createProject(by(owner), { name: fresh('Zeta') })
      const alpha = await service.createProject(by(owner), { name: fresh('Alpha') })
      await service.createProject(by(bob), { name: fresh('Bobs') })
      expect(await service.listProjects(by(owner))).toEqual([alpha, zeta])
    })

    it('lists a project someone was given a role in by its admin', async () => {
      const owner = await seedAccount(x.db, { username: fresh('owner') })
      const guest = await seedAccount(x.db, { username: fresh('guest') })
      const project = await service.createProject(by(owner), { name: fresh('Shared') })
      await roles.setRole(by(owner), project.id, guest.id, 'read-only')
      expect(await service.listProjects(by(guest))).toEqual([project])
    })

    it('lists nothing for someone with no role, or a caller id that is not a UUID', async () => {
      const owner = await seedAccount(x.db, { username: fresh('owner') })
      expect(await service.listProjects(by(owner))).toEqual([])
      expect(await service.listProjects({ accountId: 'nobody', channel: 'ui' })).toEqual([])
    })
  })
})

describe('test cases through the REST API', () => {
  // Each test case starts from its own fresh test deployment, as the test cases ask.
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Seeded
  let erin: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    erin = await seedAccount(x.db, { username: 'erin' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const create = (account: Seeded, name: string) =>
    app.inject({ method: 'POST', url: '/api/projects', headers: as(account), payload: { name } })

  describe('TC-178: anyone with an account creates a project', () => {
    it("lets erin, with no role anywhere and not a system admin, create and then list Erin's project", async () => {
      const created = await create(erin, "Erin's project")
      expect(created.statusCode).toBe(201)

      const listed = await app.inject({ method: 'GET', url: '/api/projects', headers: as(erin) })
      expect(listed.statusCode).toBe(200)
      expect(listed.json()).toEqual([{ id: created.json().id, name: "Erin's project" }])

      // Negative: no other project is created.
      expect(await x.db.select().from(projects)).toHaveLength(1)
    })
  })

  describe("TC-230: a project's creator becomes its admin", () => {
    it("makes erin admin of Erin's project and gives root no role in it", async () => {
      const created = await create(erin, "Erin's project")
      const { id } = created.json<{ id: string }>()
      const members = await app.inject({
        method: 'GET',
        url: `/api/projects/${id}/members`,
        headers: as(erin),
      })
      expect(members.statusCode).toBe(200)
      // erin is its admin, and its only member: root is given no role in it.
      expect(members.json()).toEqual([{ accountId: erin.id, username: 'erin', role: 'admin' }])
      expect(
        await x.db.select().from(projectMembers).where(eq(projectMembers.accountId, root.id)),
      ).toEqual([])
    })
  })
})
