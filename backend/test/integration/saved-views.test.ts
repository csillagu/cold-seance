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
  savedViewProjects,
  savedViews,
  tasks,
} from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import type { SavedViewInput } from '../../src/service/saved-views.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The saved view module (SC-020) and group deletion (SC-059) against a real PostgreSQL: their
// rules through the service layer, then the test cases of FR-054 to FR-058, FR-126 and FR-161,
// and the saved-view part of FR-059's, through the REST API. The browser parts of these test
// cases are the saved view editor's and the filter builder's (SC-091, SC-092, node F22), and the
// group screens' (SC-082 to SC-084, node F06).

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

describe('the saved view service and group deletion', () => {
  let x: TestDatabase
  let services: Services
  let root: Seeded
  let alice: Seeded
  let bob: Seeded
  let carol: Seeded
  let counter = 0
  const fresh = (base: string) => `${base}-${++counter}`

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    carol = await seedAccount(x.db, { username: 'carol' })
  })

  afterAll(async () => {
    await x?.drop()
  })

  const save = (account: Seeded, view: SavedViewInput) =>
    services.savedViews.saveView(by(account), view)

  /** A group of alice's holding the given projects, with the given members. */
  async function group(
    projectIds: string[],
    members: [Seeded, 'read-only' | 'contributor' | 'read-write' | 'admin'][] = [],
  ): Promise<string> {
    const created = await services.groups.createGroup(by(alice), { name: fresh('Platform') })
    for (const projectId of projectIds) {
      await services.groups.addProject(by(alice), created.id, projectId)
    }
    for (const [account, role] of members) {
      await services.groups.setMemberRole(by(alice), created.id, account.id, role)
    }
    return created.id
  }

  describe('saveView', () => {
    it('saves a view kept in a project, covering it, and records it in the audit log', async () => {
      const apollo = await seedProject(x.db, alice)
      const filter = [{ field: 'status', operator: 'is', value: 'in-progress' }]
      const view = await save(alice, {
        name: '  Team board ',
        kind: 'kanban',
        keptIn: 'project',
        projectId: apollo,
        filter,
      })
      expect(view).toEqual({
        id: expect.any(String),
        name: 'Team board',
        kind: 'kanban',
        keptIn: 'project',
        projectId: apollo,
        groupId: null,
        ownerId: null,
        projects: [apollo],
        filter,
      })
      const [entry] = await x.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'saved-view.created'), eq(auditLog.subjectId, view.id)))
      expect(entry).toMatchObject({
        actorAccountId: alice.id,
        projectId: apollo,
        subjectType: 'saved-view',
        details: { name: 'Team board', kind: 'kanban', keptIn: 'project', projects: [apollo] },
      })
    })

    it("lets only the project's read-write members and admins save a view in it", async () => {
      const apollo = await seedProject(x.db, alice)
      await grantRole(x.db, bob, apollo, 'read-write')
      await grantRole(x.db, carol, apollo, 'contributor')
      const view = { name: 'Board', kind: 'kanban', keptIn: 'project', projectId: apollo }
      expect((await save(bob, view)).projectId).toBe(apollo)
      await refused(save(carol, view), 'forbidden')
      await grantRole(x.db, carol, apollo, 'read-only')
      await refused(save(carol, view), 'forbidden')
      const dave = await seedAccount(x.db, { username: fresh('dave') })
      await refused(save(dave, view), 'not-visible')
      await refused(save(alice, { ...view, projectId: 'Apollo' }), 'not-visible')
    })

    it('keeps a project view to its own project (FR-056)', async () => {
      const apollo = await seedProject(x.db, alice)
      const borealis = await seedProject(x.db, alice)
      const view = { name: 'Both', kind: 'kanban', keptIn: 'project', projectId: apollo }
      expect((await save(alice, { ...view, projects: [apollo, apollo] })).projects).toEqual([
        apollo,
      ])
      await refused(save(alice, { ...view, projects: [apollo, borealis] }), 'invalid')
      await refused(save(alice, { ...view, projects: [borealis] }), 'invalid')
    })

    it("lets only the group's read-write members and admins save a view in it", async () => {
      const apollo = await seedProject(x.db, alice)
      const dave = await seedAccount(x.db, { username: fresh('dave') })
      const erin = await seedAccount(x.db, { username: fresh('erin') })
      const platform = await group(
        [apollo],
        [
          [bob, 'read-write'],
          [carol, 'contributor'],
          [dave, 'read-only'],
        ],
      )
      const view = {
        name: 'Platform board',
        kind: 'gantt',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo],
      }
      expect(await save(bob, view)).toMatchObject({ keptIn: 'group', groupId: platform })
      expect(await save(alice, view)).toMatchObject({ keptIn: 'group', projects: [apollo] })
      await refused(save(carol, view), 'forbidden')
      await refused(save(dave, view), 'forbidden')
      // erin holds the read-write role in Apollo directly, but is not a member of the group.
      await grantRole(x.db, erin, apollo, 'read-write')
      await refused(save(erin, view), 'forbidden')
      await refused(
        save(alice, { ...view, groupId: '6f1c2a5e-0000-4000-8000-0000000000aa' }),
        'not-found',
      )
    })

    it("keeps a group view to the group's projects, and to at least one (FR-056)", async () => {
      const apollo = await seedProject(x.db, alice)
      const ceres = await seedProject(x.db, alice)
      const platform = await group([apollo])
      const view = { name: 'Plan', kind: 'gantt', keptIn: 'group', groupId: platform }
      await refused(save(alice, { ...view, projects: [apollo, ceres] }), 'invalid')
      await refused(save(alice, { ...view, projects: [] }), 'invalid')
      await refused(save(alice, view), 'invalid')
      expect(await services.savedViews.listGroupViews(by(alice), platform)).toEqual([])
    })

    it('keeps a personal view to projects its owner can read (FR-056)', async () => {
      const apollo = await seedProject(x.db, alice)
      const borealis = await seedProject(x.db, bob)
      const ceres = await seedProject(x.db, bob)
      await grantRole(x.db, alice, borealis, 'read-only')
      const view = { name: 'Mine', kind: 'kanban', keptIn: 'personal' }
      const saved = await save(alice, { ...view, projects: [borealis, apollo] })
      expect(saved).toMatchObject({ keptIn: 'personal', ownerId: alice.id, projectId: null })
      expect(new Set(saved.projects)).toEqual(new Set([apollo, borealis]))
      await refused(save(alice, { ...view, projects: [apollo, ceres] }), 'not-visible')
      await refused(save(alice, { ...view, projects: ['Ceres'] }), 'not-visible')
      await refused(save(alice, { ...view, projects: [3] }), 'invalid')
    })

    it('refuses a view with no name, a kind that has no saved views, or no place', async () => {
      const apollo = await seedProject(x.db, alice)
      const view = { name: 'Board', kind: 'kanban', keptIn: 'personal', projects: [apollo] }
      for (const name of [undefined, '', '   ', 3, 'x'.repeat(201)]) {
        await refused(save(alice, { ...view, name }), 'invalid')
      }
      expect((await save(alice, { ...view, name: 'é'.repeat(200) })).name).toHaveLength(200)
      for (const kind of ['person-load', 'baseline-variance', undefined]) {
        await refused(save(alice, { ...view, kind }), 'invalid')
      }
      await refused(save(alice, { ...view, keptIn: 'team' }), 'invalid')
      await refused(save(alice, { ...view, keptIn: 'project' }), 'invalid')
      await refused(save(alice, { ...view, groupId: apollo }), 'invalid')
      await refused(save(alice, { ...view, projectId: apollo }), 'invalid')
      await refused(save(alice, { ...view, filter: [{ field: 'colour' }] }), 'invalid')
      await refused(
        services.savedViews.saveView({ accountId: 'nobody', channel: 'ui' }, view),
        'forbidden',
      )
    })
  })

  describe('reading saved views', () => {
    it('shows each view only to those who see it, and lists each place apart (FR-055)', async () => {
      const apollo = await seedProject(x.db, alice)
      const platform = await group([apollo], [[bob, 'read-only']])
      await grantRole(x.db, carol, apollo, 'read-only')
      const inProject = await save(alice, {
        name: fresh('B project'),
        kind: 'kanban',
        keptIn: 'project',
        projectId: apollo,
      })
      const inGroup = await save(alice, {
        name: fresh('A group'),
        kind: 'gantt',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo],
      })
      const personal = await save(alice, {
        name: fresh('C mine'),
        kind: 'kanban',
        keptIn: 'personal',
        projects: [apollo],
      })
      const ids = (views: { id: string }[]) => views.map((view) => view.id)
      const mine = ids(await services.savedViews.listViews(by(alice)))
      expect(mine).toEqual(expect.arrayContaining([inGroup.id, inProject.id, personal.id]))
      // By name.
      expect(mine.indexOf(inGroup.id)).toBeLessThan(mine.indexOf(inProject.id))
      // bob, a member of the group, reads Apollo through it.
      const bobs = ids(await services.savedViews.listViews(by(bob)))
      expect(bobs).toEqual(expect.arrayContaining([inGroup.id, inProject.id]))
      expect(bobs).not.toContain(personal.id)
      // carol reads Apollo directly, and is not in the group.
      const carols = ids(await services.savedViews.listViews(by(carol)))
      expect(carols).toContain(inProject.id)
      expect(carols).not.toContain(inGroup.id)
      expect(carols).not.toContain(personal.id)

      expect(ids(await services.savedViews.listProjectViews(by(carol), apollo))).toEqual([
        inProject.id,
      ])
      expect(ids(await services.savedViews.listGroupViews(by(bob), platform))).toEqual([inGroup.id])
      await refused(services.savedViews.listGroupViews(by(carol), platform), 'forbidden')
      await refused(services.savedViews.listGroupViews(by(carol), 'nothing'), 'not-found')
      const dave = await seedAccount(x.db, { username: fresh('dave') })
      await refused(services.savedViews.listProjectViews(by(dave), apollo), 'not-visible')
      expect(await services.savedViews.listViews({ accountId: 'nobody', channel: 'ui' })).toEqual(
        [],
      )

      expect(await services.savedViews.getView(by(carol), inProject.id)).toEqual(inProject)
      await refused(services.savedViews.getView(by(carol), personal.id), 'not-found')
      await refused(services.savedViews.getView(by(carol), inGroup.id), 'not-found')
      await refused(services.savedViews.openView(by(carol), inGroup.id), 'not-found')
      await refused(services.savedViews.getView(by(alice), 'nothing'), 'not-found')
    })

    it('opens a group view on only the projects still in the group (FR-056)', async () => {
      const apollo = await seedProject(x.db, alice)
      const borealis = await seedProject(x.db, alice)
      const platform = await group([apollo, borealis])
      const inApollo = await services.tasks.createTask(by(alice), apollo, { title: 'A' })
      const inBorealis = await services.tasks.createTask(by(alice), borealis, { title: 'B' })
      const view = await save(alice, {
        name: 'Plan',
        kind: 'gantt',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo, borealis],
      })
      const opened = async () =>
        (await services.savedViews.openView(by(alice), view.id)).map((task) => task.id)
      expect(new Set(await opened())).toEqual(new Set([inApollo.id, inBorealis.id]))
      // No SC takes a project out of a group yet; the row goes as such a change would take it.
      await x.db
        .delete(groupProjects)
        .where(and(eq(groupProjects.groupId, platform), eq(groupProjects.projectId, borealis)))
      expect(await opened()).toEqual([inApollo.id])
    })
  })

  describe('deleteGroup', () => {
    it('deletes the group, its members, its projects and its views, and logs it', async () => {
      const apollo = await seedProject(x.db, alice)
      const platform = await group([apollo], [[bob, 'read-write']])
      const view = await save(alice, {
        name: 'Plan',
        kind: 'gantt',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo],
      })
      await services.groups.deleteGroup(by(root), platform)
      expect(await x.db.select().from(groups).where(eq(groups.id, platform))).toEqual([])
      expect(
        await x.db.select().from(groupMembers).where(eq(groupMembers.groupId, platform)),
      ).toEqual([])
      expect(
        await x.db.select().from(groupProjects).where(eq(groupProjects.groupId, platform)),
      ).toEqual([])
      expect(await x.db.select().from(savedViews).where(eq(savedViews.id, view.id))).toEqual([])
      expect(
        await x.db.select().from(savedViewProjects).where(eq(savedViewProjects.viewId, view.id)),
      ).toEqual([])
      // The project stays, and bob's role through the group ends with it.
      expect(await x.db.select().from(projects).where(eq(projects.id, apollo))).toHaveLength(1)
      expect(await services.projectRoles.roleOf(bob.id, apollo)).toBeUndefined()
      const [entry] = await x.db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, 'group.deleted'), eq(auditLog.subjectId, platform)))
      expect(entry).toMatchObject({ actorAccountId: root.id, subjectType: 'group' })
    })

    it('lets only a system admin delete a group, and refuses one that does not exist', async () => {
      const platform = await group([], [[bob, 'read-write']])
      await refused(services.groups.deleteGroup(by(alice), platform), 'forbidden')
      await refused(services.groups.deleteGroup(by(bob), platform), 'forbidden')
      await refused(
        services.groups.deleteGroup({ accountId: 'nobody', channel: 'ui' }, platform),
        'forbidden',
      )
      expect(await x.db.select().from(groups).where(eq(groups.id, platform))).toHaveLength(1)
      await refused(services.groups.deleteGroup(by(root), 'nothing'), 'not-found')
      await services.groups.deleteGroup(by(root), platform)
      await refused(services.groups.deleteGroup(by(root), platform), 'not-found')
    })
  })
})

describe('test cases through the REST API', () => {
  // Each test case starts from its own fresh test deployment, as the test cases ask.
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let root: Seeded
  let alice: Seeded
  let bob: Seeded

  beforeEach(async () => {
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    root = await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterEach(async () => {
    await app?.close()
    await x?.drop()
  })

  const request = (
    account: Seeded,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api${url}`,
      headers: as(account),
      ...(payload === undefined ? {} : { payload }),
    })

  /** The answer's body, once it is shown to be a success. */
  const ok = async <T = unknown>(response: ReturnType<typeof request>): Promise<T> => {
    const answer = await response
    expect({ status: answer.statusCode, body: answer.json() }).toMatchObject({
      status: expect.toSatisfy((status: number) => status < 300),
    })
    return answer.json<T>()
  }

  const createProject = async (account: Seeded, name: string) =>
    (await ok<{ id: string }>(request(account, 'POST', '/projects', { name }))).id
  const createGroup = async (account: Seeded, name: string) =>
    (await ok<{ id: string }>(request(account, 'POST', '/groups', { name }))).id
  const addToGroup = (account: Seeded, groupId: string, projectId: string) =>
    ok(request(account, 'PUT', `/groups/${groupId}/projects/${projectId}`))
  const addMember = (groupId: string, member: Seeded, role: string) =>
    ok(request(alice, 'PUT', `/groups/${groupId}/members/${member.id}`, { role }))
  const giveRole = (account: Seeded, projectId: string, member: Seeded, role: string) =>
    ok(request(account, 'PUT', `/projects/${projectId}/members/${member.id}`, { role }))
  const createTask = async (projectId: string, task: object, account = alice) =>
    (await ok<{ id: string }>(request(account, 'POST', `/projects/${projectId}/tasks`, task))).id

  interface View {
    id: string
    name: string
    kind: string
    projects: string[]
    filter: unknown[]
  }
  const saveView = (account: Seeded, view: object) => request(account, 'POST', '/saved-views', view)
  const listViews = async (account: Seeded, url = '/saved-views') =>
    ok<View[]>(request(account, 'GET', url))
  const names = (views: View[]) => views.map((view) => view.name)
  const open = async (account: Seeded, viewId: string) =>
    (await ok<{ title: string }[]>(request(account, 'GET', `/saved-views/${viewId}/tasks`))).map(
      (task) => task.title,
    )

  describe('TC-073: named Kanban and Gantt views can be saved', () => {
    it("saves alice's Team board and Q1 plan, lists them and opens each as its kind", async () => {
      const apollo = await createProject(alice, 'Apollo')
      const started = await createTask(apollo, { title: 'Started' })
      await createTask(apollo, { title: 'Waiting' })
      await ok(request(alice, 'PUT', `/tasks/${started}/status`, { status: 'in-progress' }))
      const before = await x.db.select().from(tasks)

      const filter = [{ field: 'status', operator: 'is', value: 'in-progress' }]
      const board = await saveView(alice, {
        name: 'Team board',
        kind: 'kanban',
        keptIn: 'personal',
        projects: [apollo],
        filter,
      })
      expect(board.statusCode).toBe(201)
      const plan = await saveView(alice, {
        name: 'Q1 plan',
        kind: 'gantt',
        keptIn: 'personal',
        projects: [apollo],
      })
      expect(plan.statusCode).toBe(201)

      // Step 2: signed in again, alice's views are still hers; each request stands alone.
      const listed = await listViews(alice)
      expect(listed.map((view) => [view.name, view.kind])).toEqual([
        ['Q1 plan', 'gantt'],
        ['Team board', 'kanban'],
      ])

      const [q1, team] = listed
      if (!q1 || !team) throw new Error('expected both views')
      expect(await ok(request(alice, 'GET', `/saved-views/${team.id}`))).toMatchObject({
        kind: 'kanban',
        filter,
      })
      expect(await open(alice, team.id)).toEqual(['Started'])
      expect(await ok(request(alice, 'GET', `/saved-views/${q1.id}`))).toMatchObject({
        kind: 'gantt',
        filter: [],
      })
      expect(await open(alice, q1.id)).toEqual(['Started', 'Waiting'])

      // Negative: neither view changes any task.
      expect(await x.db.select().from(tasks)).toEqual(before)
    })
  })

  describe('TC-074: person load and baseline variance views cannot be saved', () => {
    it('rejects a person load view named Load view (step 3)', async () => {
      const apollo = await createProject(alice, 'Apollo')
      await ok(request(alice, 'POST', `/projects/${apollo}/baselines`, { name: 'v1' }))
      for (const kind of ['person-load', 'baseline-variance']) {
        const attempt = await saveView(alice, {
          name: 'Load view',
          kind,
          keptIn: 'personal',
          projects: [apollo],
        })
        expect(attempt.statusCode).toBe(400)
      }
      // Negative: alice has no saved view at all.
      expect(await listViews(alice)).toEqual([])
    })

    // Pending: TC-074 steps 1 and 2, that neither view offers to be saved in the browser
    // (SC-091, node F22).
  })

  describe('TC-075: a view kept in a project is seen by anyone who can read the project', () => {
    it('shows Apollo board to bob, with the read-only role, and not to dave', async () => {
      const dave = await seedAccount(x.db, { username: 'dave' })
      const apollo = await createProject(alice, 'Apollo')
      await giveRole(alice, apollo, bob, 'read-only')
      const saved = await saveView(alice, {
        name: 'Apollo board',
        kind: 'kanban',
        keptIn: 'project',
        projectId: apollo,
      })
      expect(saved.statusCode).toBe(201)
      const { id } = saved.json<View>()

      expect(names(await listViews(bob, `/projects/${apollo}/saved-views`))).toEqual([
        'Apollo board',
      ])
      expect((await request(bob, 'GET', `/saved-views/${id}`)).statusCode).toBe(200)
      expect((await request(bob, 'GET', `/saved-views/${id}/tasks`)).statusCode).toBe(200)

      // Negative: dave sees no view, and cannot open it.
      expect(await listViews(dave)).toEqual([])
      expect((await request(dave, 'GET', `/saved-views/${id}`)).statusCode).toBe(404)
      expect((await request(dave, 'GET', `/projects/${apollo}/saved-views`)).statusCode).toBe(403)
    })
  })

  describe("TC-076: a view kept in a group is seen by the group's members", () => {
    it('shows Platform board to bob, a member, and not to dave, who reads Apollo directly', async () => {
      const dave = await seedAccount(x.db, { username: 'dave' })
      const platform = await createGroup(alice, 'Platform')
      await addMember(platform, bob, 'read-only')
      const apollo = await createProject(alice, 'Apollo')
      await addToGroup(alice, platform, apollo)
      await giveRole(alice, apollo, dave, 'read-only')
      const saved = await saveView(alice, {
        name: 'Platform board',
        kind: 'kanban',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo],
      })
      expect(saved.statusCode).toBe(201)

      expect(names(await listViews(bob))).toEqual(['Platform board'])
      // Negative: dave can read Apollo, but does not see the group's view.
      expect(names(await listViews(dave))).toEqual([])
    })
  })

  describe('TC-077: a personal view is seen by its owner only', () => {
    it("shows My plan to alice, and not to bob, in Apollo or among bob's own", async () => {
      const apollo = await createProject(alice, 'Apollo')
      await giveRole(alice, apollo, bob, 'read-write')
      const saved = await saveView(alice, {
        name: 'My plan',
        kind: 'gantt',
        keptIn: 'personal',
        projects: [apollo],
      })
      expect(saved.statusCode).toBe(201)

      expect(names(await listViews(alice))).toEqual(['My plan'])
      // Negative.
      expect(names(await listViews(bob, `/projects/${apollo}/saved-views`))).toEqual([])
      expect(names(await listViews(bob))).toEqual([])
      expect((await request(bob, 'GET', `/saved-views/${saved.json<View>().id}`)).statusCode).toBe(
        404,
      )
    })
  })

  describe('TC-078: a view kept in a project cannot cover another project', () => {
    it('rejects Both, kept in Apollo and covering Apollo and Borealis', async () => {
      const apollo = await createProject(alice, 'Apollo')
      const borealis = await createProject(alice, 'Borealis')
      await createTask(borealis, { title: 'B-task' })
      const attempt = await saveView(alice, {
        name: 'Both',
        kind: 'kanban',
        keptIn: 'project',
        projectId: apollo,
        projects: [apollo, borealis],
      })
      expect(attempt.statusCode).toBe(400)

      // Negative: no view kept in Apollo shows a task of Borealis.
      const kept = await listViews(alice, `/projects/${apollo}/saved-views`)
      expect(kept).toEqual([])
      for (const view of kept) expect(await open(alice, view.id)).not.toContain('B-task')
    })
  })

  describe("TC-079: a view kept in a group covers only the group's projects", () => {
    it('saves Platform plan over Apollo and Borealis, and rejects Too wide over Ceres', async () => {
      const platform = await createGroup(alice, 'Platform')
      const apollo = await createProject(alice, 'Apollo')
      const borealis = await createProject(alice, 'Borealis')
      const ceres = await createProject(alice, 'Ceres')
      await addToGroup(alice, platform, apollo)
      await addToGroup(alice, platform, borealis)

      const first = await saveView(alice, {
        name: 'Platform plan',
        kind: 'gantt',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo, borealis],
      })
      expect(first.statusCode).toBe(201)
      expect(first.json<View>().projects).toEqual([apollo, borealis])
      const second = await saveView(alice, {
        name: 'Too wide',
        kind: 'gantt',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo, ceres],
      })
      expect(second.statusCode).toBe(400)

      const kept = await listViews(alice, `/groups/${platform}/saved-views`)
      expect(kept.map((view) => [view.name, view.projects])).toEqual([
        ['Platform plan', [apollo, borealis]],
      ])
      // Negative: no view kept in Platform covers Ceres.
      expect(kept.some((view) => view.projects.includes(ceres))).toBe(false)
    })
  })

  describe('TC-080: a personal view covers only what its owner can read', () => {
    it("saves alice's view over Apollo and Borealis, and rejects one over Ceres", async () => {
      const apollo = await createProject(alice, 'Apollo')
      const borealis = await createProject(bob, 'Borealis')
      const ceres = await createProject(bob, 'Ceres')
      await giveRole(bob, borealis, alice, 'read-only')
      await createTask(ceres, { title: 'C-task' }, bob)

      const first = await saveView(alice, {
        name: 'Both',
        kind: 'kanban',
        keptIn: 'personal',
        projects: [apollo, borealis],
      })
      expect(first.statusCode).toBe(201)
      const second = await saveView(alice, {
        name: 'With Ceres',
        kind: 'kanban',
        keptIn: 'personal',
        projects: [apollo, ceres],
      })
      expect(second.statusCode).toBe(403)

      // Negative: no view of alice's shows a task of Ceres.
      for (const view of await listViews(alice)) {
        expect(view.projects).not.toContain(ceres)
        expect(await open(alice, view.id)).not.toContain('C-task')
      }
    })
  })

  describe('TC-081: a saved view filters on each task field', () => {
    it('shows T1 only, through a view filtered on each field', async () => {
      const apollo = await createProject(alice, 'Apollo')
      await giveRole(alice, apollo, bob, 'read-only')
      const t1 = await createTask(apollo, {
        title: 'T1',
        description: 'alpha',
        plannedStart: '2027-03-01',
        durationWorkingDays: 2,
        effort: 3,
        aiShare: 0,
        eligibility: alice.id,
        assignees: [alice.id],
      })
      await ok(request(alice, 'PUT', `/tasks/${t1}/status`, { status: 'in-progress' }))
      await createTask(apollo, {
        title: 'T2',
        description: 'beta',
        plannedStart: '2027-03-08',
        durationWorkingDays: 5,
        effort: 8,
        aiShare: 50,
        eligibility: bob.id,
        assignees: [bob.id],
      })

      const filters = [
        { field: 'title', operator: 'is', value: 'T1' },
        { field: 'description', operator: 'is', value: 'alpha' },
        { field: 'status', operator: 'is', value: 'in-progress' },
        { field: 'plannedStart', operator: 'is', value: '2027-03-01' },
        { field: 'plannedFinish', operator: 'is', value: '2027-03-02' },
        { field: 'durationWorkingDays', operator: 'is', value: 2 },
        { field: 'effort', operator: 'is', value: 3 },
        { field: 'aiShare', operator: 'is', value: 0 },
        { field: 'eligibility', operator: 'contains', value: { accountId: alice.id } },
        { field: 'assignees', operator: 'contains', value: { accountId: alice.id } },
      ]
      for (const condition of filters) {
        const saved = await saveView(alice, {
          name: `By ${condition.field}`,
          kind: 'kanban',
          keptIn: 'personal',
          projects: [apollo],
          filter: [condition],
        })
        expect({ field: condition.field, status: saved.statusCode }).toEqual({
          field: condition.field,
          status: 201,
        })
        // Negative: T2 is not shown.
        const shown = await open(alice, saved.json<View>().id)
        expect({ field: condition.field, shown }).toEqual({ field: condition.field, shown: ['T1'] })
      }
    })
  })

  describe('TC-082: a group view filtered on the viewer shows each viewer their own tasks', () => {
    it('shows alice A-task and bob B-task through the one MY kanban', async () => {
      const platform = await createGroup(alice, 'Platform')
      await addMember(platform, bob, 'read-write')
      const apollo = await createProject(alice, 'Apollo')
      await addToGroup(alice, platform, apollo)
      await createTask(apollo, { title: 'A-task', assignees: [alice.id] })
      await createTask(apollo, { title: 'B-task', assignees: [bob.id] })
      const filter = [{ field: 'assignees', operator: 'contains', value: { viewer: true } }]
      const saved = await saveView(alice, {
        name: 'MY kanban',
        kind: 'kanban',
        keptIn: 'group',
        groupId: platform,
        projects: [apollo],
        filter,
      })
      expect(saved.statusCode).toBe(201)
      const { id } = saved.json<View>()

      expect(await open(alice, id)).toEqual(['A-task'])
      expect(await open(bob, id)).toEqual(['B-task'])
      // Negative: the saved filter is the same for both, unchanged by either opening.
      expect((await ok<View>(request(bob, 'GET', `/saved-views/${id}`))).filter).toEqual(filter)
      expect((await ok<View>(request(alice, 'GET', `/saved-views/${id}`))).filter).toEqual(filter)
    })
  })

  describe('TC-083: a view shows no tasks of a project its viewer can no longer read', () => {
    it("stops showing B-task in alice's saved view once bob removes her from Borealis", async () => {
      const apollo = await createProject(alice, 'Apollo')
      const borealis = await createProject(bob, 'Borealis')
      await giveRole(bob, borealis, alice, 'read-only')
      await createTask(apollo, { title: 'A-task' })
      await createTask(borealis, { title: 'B-task' }, bob)
      const saved = await saveView(alice, {
        name: 'Both',
        kind: 'kanban',
        keptIn: 'personal',
        projects: [apollo, borealis],
      })
      expect(saved.statusCode).toBe(201)
      const { id } = saved.json<View>()
      expect(await open(alice, id)).toEqual(['A-task', 'B-task'])

      const removed = await request(bob, 'DELETE', `/projects/${borealis}/members/${alice.id}`)
      expect(removed.statusCode).toBe(204)

      expect(await open(alice, id)).toEqual(['A-task'])
      // Negative: nothing of Borealis is shown, not even that the view covers it.
      const view = await ok<View>(request(alice, 'GET', `/saved-views/${id}`))
      expect(view.projects).toEqual([apollo])
      expect(JSON.stringify(view)).not.toContain(borealis)
    })
  })

  describe('TC-187: a system admin deletes a group', () => {
    it('lets root delete Platform, leaving Apollo with alice as its admin', async () => {
      const platform = await createGroup(alice, 'Platform')
      const apollo = await createProject(alice, 'Apollo')
      await addToGroup(alice, platform, apollo)

      expect((await request(root, 'DELETE', `/groups/${platform}`)).statusCode).toBe(204)
      expect(await ok(request(root, 'GET', '/groups'))).toEqual([])
      // Negative: Apollo stays, with alice as its admin.
      expect(await ok(request(alice, 'GET', '/projects'))).toMatchObject([
        { id: apollo, name: 'Apollo' },
      ])
      expect(
        await x.db.select().from(projectMembers).where(eq(projectMembers.projectId, apollo)),
      ).toMatchObject([{ accountId: alice.id, role: 'admin' }])
    })
  })

  describe('TC-188: a group admin who is not a system admin cannot delete the group', () => {
    it("refuses alice's deletion of Platform, which keeps its members", async () => {
      const platform = await createGroup(alice, 'Platform')
      expect((await request(alice, 'DELETE', `/groups/${platform}`)).statusCode).toBe(403)
      expect(await ok(request(alice, 'GET', '/groups'))).toEqual([
        { id: platform, name: 'Platform' },
      ])
      // Negative: Platform keeps its members.
      expect(await ok(request(alice, 'GET', `/groups/${platform}/members`))).toEqual([
        { accountId: alice.id, username: 'alice', role: 'admin' },
      ])
    })
  })

  describe('TC-233: deleting a group deletes its saved views', () => {
    it('takes Group board with Platform, and leaves Project board and My board', async () => {
      const platform = await createGroup(alice, 'Platform')
      const apollo = await createProject(alice, 'Apollo')
      await addToGroup(alice, platform, apollo)
      const views = [
        { name: 'Group board', keptIn: 'group', groupId: platform, projects: [apollo] },
        { name: 'Project board', keptIn: 'project', projectId: apollo },
        { name: 'My board', keptIn: 'personal', projects: [apollo] },
      ]
      for (const view of views) {
        expect((await saveView(alice, { kind: 'kanban', ...view })).statusCode).toBe(201)
      }
      expect(names(await listViews(alice))).toEqual(['Group board', 'My board', 'Project board'])

      expect((await request(root, 'DELETE', `/groups/${platform}`)).statusCode).toBe(204)
      // Negative: the other two stay.
      expect(names(await listViews(alice))).toEqual(['My board', 'Project board'])
    })

    // Pending: TC-233's browser steps are the group screens' (SC-082, node F06) and the saved
    // view editor's (SC-091, node F22).
  })
})
