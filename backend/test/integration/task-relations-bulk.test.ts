import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import type { Caller } from '../../src/service/caller.ts'
import { ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskRelations } from '../../src/service/task-relations.ts'
import type { TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The relations of every task of a project, and of every task a saved view shows, in one read
// (#269), against a real PostgreSQL: each answered as the task's own relations are (SC-002).

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

const FIXED = { variant: 'fixed-date', date: '2027-03-12' } as const

describe('the relations of many tasks in one read', () => {
  let x: TestDatabase
  let services: Services
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let reader: Seeded
  let stranger: Seeded
  let bob: Seeded

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    app = buildApp({}, { authenticators: [testAuthenticator], services })
    alice = await seedAccount(x.db, { username: 'alice' })
    reader = await seedAccount(x.db, { username: 'reader' })
    stranger = await seedAccount(x.db, { username: 'stranger' })
    bob = await seedAccount(x.db, { username: 'bob' })
  })

  afterAll(async () => {
    await app?.close()
    await x?.drop()
  })

  const make = async (owner: Seeded, project: string, title: string, extra: TaskInput = {}) =>
    (await services.tasks.createTask(by(owner), project, { title, ...extra })).id

  /**
   * A project of alice's, read-only to reader, whose tasks have every kind of relation: a parent
   * with two subtasks, made in the other order; a task blocked by two tasks of its project; and a
   * task blocked by a milestone of bob's Borealis, which alice can read and reader cannot.
   */
  async function seedPlan() {
    const apollo = await seedProject(x.db, alice)
    const borealis = await seedProject(x.db, bob)
    await grantRole(x.db, reader, apollo, 'read-only')
    await grantRole(x.db, alice, borealis, 'read-only')
    const relations = services.taskRelations
    const parent = await make(alice, apollo, 'Parent')
    const first = await make(alice, apollo, 'First')
    const second = await make(alice, apollo, 'Second')
    const blocked = await make(alice, apollo, 'Blocked')
    const launch = await make(bob, borealis, 'Launch', { milestone: FIXED })
    await relations.setParent(by(alice), second, parent)
    await relations.setParent(by(alice), first, parent)
    await relations.addBlocker(by(alice), blocked, second)
    await relations.addBlocker(by(alice), blocked, first)
    await relations.addBlocker(by(alice), first, launch)
    return { apollo, borealis, ids: [parent, first, second, blocked], launch }
  }

  /** Each task's relations as `getRelations` answers them, one by one. */
  const oneByOne = (who: Seeded, ids: readonly string[]) =>
    Promise.all(ids.map((id) => services.taskRelations.getRelations(by(who), id)))

  describe('listRelations', () => {
    it("answers each task's relations, in creation order, as getRelations does", async () => {
      const { apollo, ids, launch, borealis } = await seedPlan()
      const listed = await services.taskRelations.listRelations(by(alice), apollo)
      expect(listed).toEqual(await oneByOne(alice, ids))
      expect(listed.map((relations) => relations.taskId)).toEqual(ids)
      const [parent, first, second] = ids
      expect(listed[0]?.subtasks.map((task) => task.id)).toEqual([first, second])
      expect(listed[1]).toMatchObject({
        parent: { id: parent, projectId: apollo },
        blockedBy: [{ id: launch, projectId: borealis }],
      })
      expect(listed[3]?.blockedBy.map((task) => task.id)).toEqual([second, first])
    })

    it('leaves out a blocker of a project the reader cannot read (FR-059)', async () => {
      const { apollo, ids } = await seedPlan()
      const listed = await services.taskRelations.listRelations(by(reader), apollo)
      expect(listed).toEqual(await oneByOne(reader, ids))
      expect(listed[1]?.blockedBy).toEqual([])
    })

    it('answers a project with no task as no relations', async () => {
      const empty = await seedProject(x.db, alice)
      expect(await services.taskRelations.listRelations(by(alice), empty)).toEqual([])
    })

    it('tells someone with no role in the project it is not visible (FR-017)', async () => {
      const { apollo } = await seedPlan()
      const error = await services.taskRelations
        .listRelations(by(stranger), apollo)
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ServiceError)
      expect(error).toMatchObject({ kind: 'not-visible' })
    })
  })

  describe('openViewRelations', () => {
    it('answers the relations of the tasks the view shows, in the order it shows them', async () => {
      const { apollo, borealis, ids, launch } = await seedPlan()
      // Of the tasks, Parent, Second and Launch have an "n" in their titles.
      const [parent, first, second] = ids
      const view = await services.savedViews.saveView(by(alice), {
        name: `Plan ${apollo}`,
        kind: 'gantt',
        keptIn: 'personal',
        projects: [apollo, borealis],
        filter: [{ field: 'title', operator: 'contains', value: 'n' }],
      })
      const shown = (await services.savedViews.openView(by(alice), view.id)).map((t) => t.id)
      expect(new Set(shown)).toEqual(new Set([parent, second, launch]))

      const listed = await services.savedViews.openViewRelations(by(alice), view.id)
      expect(listed.map((relations) => relations.taskId)).toEqual(shown)
      expect(listed).toEqual(await oneByOne(alice, shown))
      expect(listed.map((relations) => relations.taskId)).not.toContain(first)
    })
  })

  describe('through the REST API', () => {
    const get = (who: Seeded, url: string) =>
      app.inject({ method: 'GET', url: `/api${url}`, headers: as(who, 'rest-api') })

    it("serves a project's task relations, and refuses a stranger", async () => {
      const { apollo, ids } = await seedPlan()
      const response = await get(alice, `/projects/${apollo}/task-relations`)
      expect(response.statusCode).toBe(200)
      expect(response.json<TaskRelations[]>()).toEqual(await oneByOne(alice, ids))
      expect((await get(stranger, `/projects/${apollo}/task-relations`)).statusCode).toBe(403)
    })

    it("serves a saved view's task relations, and refuses whoever does not see the view", async () => {
      const { apollo, ids } = await seedPlan()
      const view = await services.savedViews.saveView(by(alice), {
        name: `Board ${apollo}`,
        kind: 'gantt',
        keptIn: 'personal',
        projects: [apollo],
      })
      const response = await get(alice, `/saved-views/${view.id}/task-relations`)
      expect(response.statusCode).toBe(200)
      expect(response.json<TaskRelations[]>()).toEqual(await oneByOne(alice, ids))
      expect((await get(reader, `/saved-views/${view.id}/task-relations`)).statusCode).toBe(404)
    })
  })
})
