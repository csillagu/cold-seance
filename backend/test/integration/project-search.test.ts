import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { projectMembers } from '../../src/db/schema.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { PROJECT_ROLES, ProjectRoleService } from '../../src/service/project-roles.ts'
import { ProjectService } from '../../src/service/projects.ts'
import { createServices } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { groupTable } from '../helpers/group-roles.ts'
import { grantRole, insertProject, seedProject } from '../helpers/projects.ts'

// Project search (SC-116) against a real PostgreSQL: a project matches when the search text is
// part of its name, whatever the case of either (FR-183), and only the projects the searcher can
// read are returned (FR-184). No test case derives from FR-183 or FR-184 yet.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

describe('the project search', () => {
  let x: TestDatabase
  let service: ProjectService
  let groups: ReturnType<typeof groupTable>
  let root: Seeded
  const fresh = (base: string) => `${base}-${randomUUID()}`
  /** A new account, so that each test sees only the projects it gives that account a role in. */
  const person = () => seedAccount(x.db, { username: fresh('person') })
  /** A project named `name`, of which `account` is the only admin. */
  const project = async (account: Seeded, name: string) => ({
    id: await seedProject(x.db, account, name),
    name,
  })

  beforeAll(async () => {
    x = await createTestDatabase()
    groups = groupTable()
    const audit = new AuditLogService(x.db)
    service = new ProjectService(x.db, audit, new ProjectRoleService(x.db, audit, groups))
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
  })

  afterAll(async () => {
    await x?.drop()
  })

  describe('matching on part of the name, ignoring case (FR-183)', () => {
    it('finds a project by the start, the middle, the end or the whole of its name', async () => {
      const alice = await person()
      const apollo = await project(alice, `Apollo Guidance ${randomUUID()}`)
      for (const text of ['Apollo', 'Guid', apollo.name.slice(-12), apollo.name]) {
        expect(await service.searchProjects(by(alice), text)).toEqual([apollo])
      }
    })

    it('ignores the case of the search text and of the name alike', async () => {
      const alice = await person()
      const mixed = await project(alice, `MiXeD Case ${randomUUID()}`)
      for (const text of ['mixed case', 'MIXED CASE', 'mIxEd cAsE', 'xed ca']) {
        expect(await service.searchProjects(by(alice), text)).toEqual([mixed])
      }
    })

    it('ignores the case of letters outside ASCII, including ß against SS', async () => {
      const alice = await person()
      const accented = await project(alice, `Éléphant Ärger ${randomUUID()}`)
      const street = await project(alice, `Hauptstraße ${randomUUID()}`)
      expect(await service.searchProjects(by(alice), 'éLÉPHANT äRGER')).toEqual([accented])
      expect(await service.searchProjects(by(alice), 'HAUPTSTRASSE')).toEqual([street])
      expect(await service.searchProjects(by(alice), 'straße')).toEqual([street])
    })

    it.each([
      ['the Turkish dotted capital İ', 'İstanbul', 'ist'],
      ['the dotless ı', 'Istanbul', 'ıstanbul'],
      ['the capital sharp ẞ', 'Hauptstraße', 'STRAẞE'],
      ['the sharp ß against a capital ẞ in the name', 'HAUPTSTRAẞE', 'straße'],
      ['the Greek final ς', 'Οδος', 'ΟΔΟΣ'],
      ['the Greek σ against a final ς', 'Οδος', 'οσ'],
    ])('ignores the case of %s', async (_, base, text) => {
      const alice = await person()
      const named = await project(alice, `${base} ${randomUUID()}`)
      expect(await service.searchProjects(by(alice), text)).toEqual([named])
    })

    it('matches an accented letter typed in either Unicode form', async () => {
      const alice = await person()
      const cafe = await project(alice, `Café ${randomUUID()}`)
      expect(await service.searchProjects(by(alice), 'café')).toEqual([cafe])
      expect(await service.searchProjects(by(alice), 'CAFÉ')).toEqual([cafe])
    })

    it('returns every matching project, by name, and none that does not match', async () => {
      const alice = await person()
      const tag = randomUUID()
      const zeta = await project(alice, `Zeta ${tag}`)
      const alpha = await project(alice, `Alpha ${tag}`)
      const beta = await project(alice, `Beta ${tag.toUpperCase()}`)
      await project(alice, `Gamma ${randomUUID()}`)
      expect(await service.searchProjects(by(alice), tag)).toEqual([alpha, beta, zeta])
    })

    it('returns nothing when no name contains the text, nor for a near miss', async () => {
      const alice = await person()
      await project(alice, `Apollo ${randomUUID()}`)
      expect(await service.searchProjects(by(alice), 'Apolo')).toEqual([])
      expect(await service.searchProjects(by(alice), 'Apollo  ')).toEqual([])
    })

    it('takes the characters % _ and \\ in the text as themselves, not as patterns', async () => {
      const alice = await person()
      const percent = await project(alice, `100% done ${randomUUID()}`)
      const underscore = await project(alice, `snake_case ${randomUUID()}`)
      const backslash = await project(alice, `back\\slash ${randomUUID()}`)
      expect(await service.searchProjects(by(alice), '%')).toEqual([percent])
      expect(await service.searchProjects(by(alice), '_')).toEqual([underscore])
      expect(await service.searchProjects(by(alice), '\\')).toEqual([backslash])
      expect(await service.searchProjects(by(alice), 'snake%case')).toEqual([])
    })

    it('finds every readable project for an empty text, which every name contains', async () => {
      const alice = await person()
      const one = await project(alice, `One ${randomUUID()}`)
      const two = await project(alice, `Two ${randomUUID()}`)
      expect(await service.searchProjects(by(alice), '')).toEqual([one, two])
    })
  })

  describe('only the projects the searcher can read (FR-184)', () => {
    it('never returns a matching project the searcher holds no role in', async () => {
      const alice = await person()
      const bob = await person()
      const tag = randomUUID()
      const mine = await project(alice, `Shared name ${tag} alice`)
      await project(bob, `Shared name ${tag} bob`)
      await insertProject(x.db, bob, `Shared name ${tag} nobody`)
      expect(await service.searchProjects(by(alice), tag)).toEqual([mine])
    })

    it.each(PROJECT_ROLES)('returns a project the searcher holds the %s role in', async (role) => {
      const owner = await person()
      const member = await person()
      const shared = await project(owner, `Role ${role} ${randomUUID()}`)
      await grantRole(x.db, member, shared.id, role)
      expect(await service.searchProjects(by(member), `ROLE ${role}`)).toEqual([shared])
    })

    it('returns a project the searcher reaches through a group, and drops it once they do not', async () => {
      const owner = await person()
      const member = await person()
      const reached = await project(owner, `Grouped ${randomUUID()}`)
      expect(await service.searchProjects(by(member), 'grouped')).toEqual([])
      groups.give(member, reached.id, 'read-only')
      expect(await service.searchProjects(by(member), 'grouped')).toEqual([reached])
      groups.takeAway(member, reached.id)
      expect(await service.searchProjects(by(member), 'grouped')).toEqual([])
    })

    it('stops returning a project once the searcher loses their role in it', async () => {
      const owner = await person()
      const member = await person()
      const shared = await project(owner, `Left ${randomUUID()}`)
      await grantRole(x.db, member, shared.id, 'contributor')
      expect(await service.searchProjects(by(member), 'left')).toEqual([shared])
      await x.db
        .delete(projectMembers)
        .where(
          and(eq(projectMembers.accountId, member.id), eq(projectMembers.projectId, shared.id)),
        )
      expect(await service.searchProjects(by(member), 'left')).toEqual([])
    })

    it('gives a system admin no project they hold no role in', async () => {
      const owner = await person()
      await project(owner, `Admin-hidden ${randomUUID()}`)
      expect(await service.searchProjects(by(root), 'admin-hidden')).toEqual([])
    })

    it('returns nothing to a caller with no account or an id that is not a UUID', async () => {
      const owner = await person()
      await project(owner, `Ghostly ${randomUUID()}`)
      for (const accountId of [randomUUID(), 'nobody', "' or 1=1 --"]) {
        expect(await service.searchProjects({ accountId, channel: 'ui' }, 'ghostly')).toEqual([])
      }
    })
  })
})

describe('the project search through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  const search = (account: Seeded, text: string) =>
    app.inject({
      method: 'GET',
      url: `/api/projects/search?text=${encodeURIComponent(text)}`,
      headers: as(account, 'rest-api'),
    })

  it('answers alice with her matching projects, by name, and not bob’s', async () => {
    const apollo = { id: await seedProject(x.db, alice, 'Apollo'), name: 'Apollo' }
    const gemini = { id: await seedProject(x.db, alice, 'Project Gemini'), name: 'Project Gemini' }
    await seedProject(x.db, alice, 'Mercury')
    await seedProject(x.db, bob, 'Apollo Soyuz')
    const shared = { id: await seedProject(x.db, bob, 'Skylab'), name: 'Skylab' }
    await grantRole(x.db, alice, shared.id, 'read-only')

    const found = await search(alice, 'O')
    expect(found.statusCode).toBe(200)
    expect(found.json()).toEqual([apollo, gemini])

    expect((await search(alice, 'SKY')).json()).toEqual([shared])
    expect((await search(alice, 'soyuz')).json()).toEqual([])
    expect((await search(bob, 'apollo')).json()).toEqual([
      expect.objectContaining({ name: 'Apollo Soyuz' }),
    ])
  })

  it('refuses a search without search text', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/search',
      headers: as(alice),
    })
    expect(response.statusCode).toBe(400)
  })

  it('refuses a caller who is not signed in', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/projects/search?text=a' })
    expect(response.statusCode).toBe(401)
  })
})
