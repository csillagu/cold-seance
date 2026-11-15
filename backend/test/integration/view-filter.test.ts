import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { AuditLogService } from '../../src/service/audit.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ProjectRoleService } from '../../src/service/project-roles.ts'
import { createServices } from '../../src/service/services.ts'
import { ViewReadFilter } from '../../src/service/view-filter.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { groupTable } from '../helpers/group-roles.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The view read filter (SC-050) against a real PostgreSQL. Views (SC-020, SC-030 to SC-033) and
// tasks (SC-001) do not exist yet, so the filter is handed what a view would show: items that
// each name the project they belong to.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

describe('the view read filter', () => {
  let x: TestDatabase
  let groups: ReturnType<typeof groupTable>
  let roles: ProjectRoleService
  let filter: ViewReadFilter
  let alice: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    groups = groupTable()
    roles = new ProjectRoleService(x.db, new AuditLogService(x.db), groups)
    filter = new ViewReadFilter(roles)
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  it('keeps, in their order, the items of every project the viewer holds any role in', async () => {
    const [p1, p2, p3, p4] = [
      await seedProject(x.db, alice),
      await seedProject(x.db, alice),
      await seedProject(x.db, alice),
      await seedProject(x.db, alice),
    ]
    const viewer = await seedAccount(x.db, { username: `viewer-${randomUUID()}` })
    await grantRole(x.db, viewer, p1, 'read-only')
    await grantRole(x.db, viewer, p2, 'contributor')
    await grantRole(x.db, viewer, p3, 'read-write')
    await grantRole(x.db, viewer, p4, 'admin')
    const items = [p4, p1, p3, p2].map((projectId, i) => ({ id: `T${i}`, projectId: projectId }))
    expect(await filter.readable(by(viewer), items)).toEqual(items)
  })

  it('drops the items of a project the viewer holds no role in, so the same items show each viewer their own', async () => {
    const own = await seedProject(x.db, alice)
    const other = await seedProject(x.db, bob)
    const items = [
      { id: 'A', projectId: own },
      { id: 'B', projectId: other },
      { id: 'A2', projectId: own },
    ]
    expect((await filter.readable(by(alice), items)).map((t) => t.id)).toEqual(['A', 'A2'])
    // The same items, seen by bob, show only his.
    expect((await filter.readable(by(bob), items)).map((t) => t.id)).toEqual(['B'])
  })

  it('keeps the items of a project the viewer reads through a group only', async () => {
    const theirs = await seedProject(x.db, bob)
    groups.give(alice, theirs, 'read-only')
    expect(await filter.readable(by(alice), [{ id: 'B', projectId: theirs }])).toEqual([
      { id: 'B', projectId: theirs },
    ])
    groups.takeAway(alice, theirs)
    expect(await filter.readable(by(alice), [{ id: 'B', projectId: theirs }])).toEqual([])
  })

  it('shows nothing to a system admin with no role, nor to a caller who is not an account', async () => {
    const root = await seedAccount(x.db, { username: `root-${randomUUID()}`, systemAdmin: true })
    const items = [{ id: 'A', projectId: await seedProject(x.db, alice) }]
    expect(await filter.readable(by(root), items)).toEqual([])
    expect(await filter.readable({ accountId: 'nobody', channel: 'ui' }, items)).toEqual([])
  })

  it('answers an empty view without asking for the roles', async () => {
    const asked: string[] = []
    const counting = new ViewReadFilter({
      readableProjects: async (accountId) => {
        asked.push(accountId)
        return new Set()
      },
    })
    expect(await counting.readable(by(alice), [])).toEqual([])
    expect(asked).toEqual([])
  })

  it('lists, as readable, the projects held directly and those held through groups', async () => {
    const viewer = await seedAccount(x.db, { username: `viewer-${randomUUID()}` })
    const direct = await seedProject(x.db, alice)
    const throughGroup = await seedProject(x.db, alice)
    await grantRole(x.db, viewer, direct, 'read-only')
    groups.give(viewer, throughGroup, 'contributor')
    expect(await roles.readableProjects(viewer.id)).toEqual(new Set([direct, throughGroup]))
    expect(await roles.readableProjects('nobody')).toEqual(new Set())
  })
})

describe('TC-083: a view shows no tasks of a project its viewer cannot read', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let services: ReturnType<typeof createServices>
  let alice: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  it('stops showing B-task to alice once bob removes her from Borealis', async () => {
    const create = async (account: Seeded, name: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/projects',
          headers: as(account),
          payload: { name },
        })
      ).json<{ id: string }>().id
    const apollo = await create(alice, 'Apollo')
    const borealis = await create(bob, 'Borealis')
    const given = await app.inject({
      method: 'PUT',
      url: `/api/projects/${borealis}/members/${alice.id}`,
      headers: as(bob),
      payload: { role: 'read-only' },
    })
    expect(given.statusCode).toBe(200)

    // What alice's personal Kanban view over Apollo and Borealis would show.
    const view = [
      { id: 'A-task', projectId: apollo },
      { id: 'B-task', projectId: borealis },
    ]
    const filter = services.viewFilter
    expect((await filter.readable(by(alice), view)).map((t) => t.id)).toEqual(['A-task', 'B-task'])

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${borealis}/members/${alice.id}`,
      headers: as(bob),
    })
    expect(removed.statusCode).toBe(204)

    const shown = await filter.readable(by(alice), view)
    expect(shown.map((t) => t.id)).toEqual(['A-task'])
    // Negative: nothing of Borealis is shown.
    expect(shown.some((t) => t.projectId === borealis)).toBe(false)
  })

  // TC-083 through alice's saved personal Kanban view (SC-020), opened before and after the
  // change, is in saved-views.test.ts; the view opened in the browser, in
  // e2e/tests/saved-views.spec.ts.
})
