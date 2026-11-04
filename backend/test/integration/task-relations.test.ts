import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../../src/app.ts'
import { auditLog, taskBlockedBy, tasks } from '../../src/db/schema.ts'
import type { Caller } from '../../src/service/caller.ts'
import { NOT_VISIBLE_MESSAGE, ServiceError } from '../../src/service/errors.ts'
import { createServices, type Services } from '../../src/service/services.ts'
import type { TaskRelations } from '../../src/service/task-relations.ts'
import type { Task, TaskInput } from '../../src/service/tasks.ts'
import { as, seedAccount, testAuthenticator } from '../helpers/accounts.ts'
import { createTestDatabase, type TestDatabase } from '../helpers/database.ts'
import { grantRole, seedProject } from '../helpers/projects.ts'

// The task relation module (SC-002: FR-014, FR-015, FR-016, FR-193) against a real PostgreSQL:
// the rules through the service layer, then their test cases through the REST API.

type Seeded = Awaited<ReturnType<typeof seedAccount>>

const by = (account: Seeded): Caller => ({ accountId: account.id, channel: 'ui' })

const FIXED = { variant: 'fixed-date', date: '2027-03-12' } as const
const FLOATING = { variant: 'floating' } as const
const MISSING = '6f1c2a5e-0000-4000-8000-00000000dead'

const CYCLE =
  'This blocked-by relation would create a cycle: the blocker is already blocked by this task, ' +
  'directly or through other tasks'

async function refused(promise: Promise<unknown>, kind: ServiceError['kind'], message?: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  )
  if (!(error instanceof ServiceError)) {
    throw new Error(`expected a ServiceError, got ${String(error)}`)
  }
  expect(error).toMatchObject(message === undefined ? { kind } : { kind, message })
  return error
}

describe('the task relation service', () => {
  let x: TestDatabase
  let services: Services
  let alice: Seeded
  let writer: Seeded
  let reader: Seeded
  let contributor: Seeded
  let stranger: Seeded
  let bob: Seeded
  let apollo: string
  let borealis: string
  let hidden: string
  let relations: Services['taskRelations']

  beforeAll(async () => {
    x = await createTestDatabase()
    services = createServices(x.db)
    relations = services.taskRelations
    alice = await seedAccount(x.db, { username: 'alice' })
    writer = await seedAccount(x.db, { username: 'writer' })
    reader = await seedAccount(x.db, { username: 'reader' })
    contributor = await seedAccount(x.db, { username: 'contributor' })
    stranger = await seedAccount(x.db, { username: 'stranger' })
    bob = await seedAccount(x.db, { username: 'bob' })
    apollo = await seedProject(x.db, alice, 'Apollo')
    borealis = await seedProject(x.db, bob, 'Borealis')
    hidden = await seedProject(x.db, bob, 'Hidden')
    await grantRole(x.db, writer, apollo, 'read-write')
    await grantRole(x.db, reader, apollo, 'read-only')
    await grantRole(x.db, contributor, apollo, 'contributor')
    await grantRole(x.db, alice, borealis, 'read-only')
  })

  afterAll(async () => {
    await x?.drop()
  })

  const make = async (project: string, task: TaskInput, owner: Seeded = alice) =>
    (await services.tasks.createTask(by(owner), project, task)).id
  const inApollo = (title: string, extra: TaskInput = {}) => make(apollo, { title, ...extra })
  const inBorealis = (title: string, extra: TaskInput = {}) =>
    make(borealis, { title, ...extra }, bob)
  const ref = (id: string, projectId = apollo) => ({ id, projectId })
  const blockersOf = async (id: string) =>
    (await x.db.select().from(taskBlockedBy).where(eq(taskBlockedBy.taskId, id))).map(
      (row) => row.blockerId,
    )
  const parentOf = async (id: string) =>
    (await x.db.select().from(tasks).where(eq(tasks.id, id)))[0]?.parentId
  /** The audit log entries of the task's relations: everything but its creation. */
  const entries = async (id: string) =>
    (
      await x.db.select().from(auditLog).where(eq(auditLog.subjectId, id)).orderBy(auditLog.id)
    ).filter((entry) => entry.action !== 'task.created')

  describe('getRelations', () => {
    it('answers a task with no relations as having none', async () => {
      const task = await inApollo('Alone')
      expect(await relations.getRelations(by(alice), task)).toEqual({
        taskId: task,
        parent: null,
        subtasks: [],
        blockedBy: [],
      })
    })

    it('answers the parent, the subtasks in creation order, and the blockers in the order made', async () => {
      const parent = await inApollo('Parent')
      const task = await inApollo('Task')
      const first = await inApollo('First subtask')
      const second = await inApollo('Second subtask')
      const b1 = await inApollo('Blocker 1')
      const b2 = await inApollo('Blocker 2')
      await relations.setParent(by(alice), task, parent)
      await relations.setParent(by(alice), second, task)
      await relations.setParent(by(alice), first, task)
      await relations.addBlocker(by(alice), task, b2)
      await relations.addBlocker(by(alice), task, b1)
      expect(await relations.getRelations(by(reader), task)).toEqual({
        taskId: task,
        parent: ref(parent),
        subtasks: [ref(first), ref(second)],
        blockedBy: [ref(b2), ref(b1)],
      })
    })

    it('lets every role read, and tells someone with no role the project is not visible', async () => {
      const task = await inApollo('Readable')
      for (const someone of [alice, writer, reader, contributor]) {
        expect((await relations.getRelations(by(someone), task)).taskId).toBe(task)
      }
      await refused(relations.getRelations(by(stranger), task), 'not-visible', NOT_VISIBLE_MESSAGE)
    })

    it.each([MISSING, 'not-a-uuid'])('refuses %s as not found', async (id) => {
      const error = await refused(relations.getRelations(by(alice), id), 'not-found')
      expect(error.message).toBe('There is no such task')
    })
  })

  describe('setParent', () => {
    it('makes a task a subtask, records it in the audit log, and answers the relations', async () => {
      const parent = await inApollo('Parent')
      const child = await inApollo('Child')
      const answer = await relations.setParent(by(writer), child, parent)
      expect(answer).toEqual({ taskId: child, parent: ref(parent), subtasks: [], blockedBy: [] })
      expect(await parentOf(child)).toBe(parent)
      expect((await relations.getRelations(by(alice), parent)).subtasks).toEqual([ref(child)])
      const [entry] = await entries(child)
      expect(entry).toMatchObject({
        actorAccountId: writer.id,
        channels: ['ui'],
        projectId: apollo,
        action: 'task.parent-set',
        subjectType: 'task',
        details: { parentId: parent, previousParentId: null },
      })
    })

    it('moves a subtask to another parent, and to none, recording the previous parent', async () => {
      const first = await inApollo('First parent')
      const second = await inApollo('Second parent')
      const child = await inApollo('Child')
      await relations.setParent(by(alice), child, first)
      await relations.setParent(by(alice), child, second)
      expect(await parentOf(child)).toBe(second)
      const cleared = await relations.setParent(by(alice), child, null)
      expect(cleared.parent).toBeNull()
      expect(await parentOf(child)).toBeNull()
      expect((await entries(child)).map((entry) => entry.details)).toEqual([
        { parentId: first, previousParentId: null },
        { parentId: second, previousParentId: first },
        { parentId: null, previousParentId: second },
      ])
    })

    it('changes nothing and records nothing when the parent is already the one given', async () => {
      const parent = await inApollo('Parent')
      const child = await inApollo('Child')
      await relations.setParent(by(alice), child, parent)
      const again = await relations.setParent(by(alice), child, parent)
      expect(again.parent).toEqual(ref(parent))
      const alone = await inApollo('Alone')
      expect((await relations.setParent(by(alice), alone, null)).parent).toBeNull()
      expect(await entries(child)).toHaveLength(1)
      expect(await entries(alone)).toHaveLength(0)
    })

    it('nests subtasks at several levels', async () => {
      const top = await inApollo('Top')
      const middle = await inApollo('Middle')
      const bottom = await inApollo('Bottom')
      await relations.setParent(by(alice), middle, top)
      await relations.setParent(by(alice), bottom, middle)
      expect((await relations.getRelations(by(alice), middle)).parent).toEqual(ref(top))
      expect((await relations.getRelations(by(alice), middle)).subtasks).toEqual([ref(bottom)])
    })

    it('refuses a task as its own parent, or as a subtask of its own subtask at any depth', async () => {
      const top = await inApollo('Top')
      const middle = await inApollo('Middle')
      const bottom = await inApollo('Bottom')
      await relations.setParent(by(alice), middle, top)
      await relations.setParent(by(alice), bottom, middle)
      const message = 'A task cannot be a subtask of itself or of one of its own subtasks'
      await refused(relations.setParent(by(alice), top, top), 'invalid', message)
      await refused(relations.setParent(by(alice), top, middle), 'invalid', message)
      await refused(relations.setParent(by(alice), top, bottom), 'invalid', message)
      expect(await parentOf(top)).toBeNull()
      expect(await entries(top)).toHaveLength(0)
    })

    it.each([
      ['fixed-date', FIXED],
      ['floating', FLOATING],
    ])('refuses a %s milestone as a subtask, or as a parent (FR-193)', async (_, milestone) => {
      const task = await inApollo('Task')
      const mark = await inApollo('Mark', { milestone })
      await refused(
        relations.setParent(by(alice), mark, task),
        'invalid',
        'A milestone cannot be a subtask of another task',
      )
      await refused(
        relations.setParent(by(alice), task, mark),
        'invalid',
        'A task cannot be a subtask of a milestone',
      )
      expect(await parentOf(mark)).toBeNull()
      expect(await parentOf(task)).toBeNull()
    })

    it('refuses a milestone as a subtask of another milestone', async () => {
      const first = await inApollo('First', { milestone: FIXED })
      const second = await inApollo('Second', { milestone: FLOATING })
      await refused(relations.setParent(by(alice), first, second), 'invalid')
      expect(await parentOf(first)).toBeNull()
    })

    it('lets a milestone be made a subtask of none, which it already is', async () => {
      const mark = await inApollo('Mark', { milestone: FIXED })
      expect((await relations.setParent(by(alice), mark, null)).parent).toBeNull()
    })

    it("refuses a parent of another project, or none, as no such task in the task's project", async () => {
      const child = await inApollo('Child')
      const elsewhere = await inBorealis('Elsewhere')
      for (const parent of [elsewhere, MISSING, 'not-a-uuid', 42, undefined]) {
        await refused(
          relations.setParent(by(alice), child, parent),
          'not-found',
          'There is no such task in this project',
        )
      }
      expect(await parentOf(child)).toBeNull()
    })

    it('refuses the read-only role and a contributor as forbidden, and a stranger as not visible', async () => {
      const parent = await inApollo('Parent')
      const child = await inApollo('Child')
      const message = "Only the project's read-write members and admins can edit its plan"
      await refused(relations.setParent(by(reader), child, parent), 'forbidden', message)
      await refused(relations.setParent(by(contributor), child, parent), 'forbidden', message)
      await refused(relations.setParent(by(stranger), child, parent), 'not-visible')
      expect(await parentOf(child)).toBeNull()
    })

    it('refuses a task that does not exist as not found', async () => {
      const parent = await inApollo('Parent')
      await refused(relations.setParent(by(alice), MISSING, parent), 'not-found')
      expect((await relations.getRelations(by(alice), parent)).subtasks).toEqual([])
    })
  })

  describe('addBlocker', () => {
    it('makes a task blocked by another of its project, and records it in the audit log', async () => {
      const task = await inApollo('Task')
      const blocker = await inApollo('Blocker')
      const answer = await relations.addBlocker(by(writer), task, blocker)
      expect(answer).toEqual({
        taskId: task,
        parent: null,
        subtasks: [],
        blockedBy: [ref(blocker)],
      })
      expect(await blockersOf(task)).toEqual([blocker])
      const [entry] = await entries(task)
      expect(entry).toMatchObject({
        actorAccountId: writer.id,
        projectId: apollo,
        action: 'task.blocker-added',
        details: { blockerId: blocker, blockerProjectId: apollo },
      })
      // The blocker's own relations are unchanged: the relation is the blocked task's.
      expect((await relations.getRelations(by(alice), blocker)).blockedBy).toEqual([])
    })

    it('lets a task be blocked by several tasks, and by a milestone of its own project', async () => {
      const task = await inApollo('Task')
      const first = await inApollo('First')
      const mark = await inApollo('Mark', { milestone: FIXED })
      await relations.addBlocker(by(alice), task, first)
      await relations.addBlocker(by(alice), task, mark)
      expect((await relations.getRelations(by(alice), task)).blockedBy).toEqual([
        ref(first),
        ref(mark),
      ])
    })

    it('lets a floating milestone be blocked by the tasks it needs', async () => {
      const mark = await inApollo('Mark', { milestone: FLOATING })
      const work = await inApollo('Work')
      await relations.addBlocker(by(alice), mark, work)
      expect(await blockersOf(mark)).toEqual([work])
    })

    it('changes nothing and records nothing when the task is already blocked by it', async () => {
      const task = await inApollo('Task')
      const blocker = await inApollo('Blocker')
      await relations.addBlocker(by(alice), task, blocker)
      const again = await relations.addBlocker(by(alice), task, blocker)
      expect(again.blockedBy).toEqual([ref(blocker)])
      expect(await entries(task)).toHaveLength(1)
    })

    it('refuses a task blocked by itself as a cycle (FR-014)', async () => {
      const task = await inApollo('Task')
      await refused(relations.addBlocker(by(alice), task, task), 'invalid', CYCLE)
      expect(await blockersOf(task)).toEqual([])
    })

    it('refuses a relation that closes a cycle of two, and of several (FR-014)', async () => {
      const a = await inApollo('A')
      const b = await inApollo('B')
      const c = await inApollo('C')
      const d = await inApollo('D')
      await relations.addBlocker(by(alice), a, b)
      await refused(relations.addBlocker(by(alice), b, a), 'invalid', CYCLE)
      await relations.addBlocker(by(alice), b, c)
      await relations.addBlocker(by(alice), c, d)
      await refused(relations.addBlocker(by(alice), d, a), 'invalid', CYCLE)
      await refused(relations.addBlocker(by(alice), c, a), 'invalid', CYCLE)
      expect(await blockersOf(d)).toEqual([])
      expect(await blockersOf(c)).toEqual([d])
      expect(await entries(d)).toHaveLength(0)
    })

    it('accepts relations that converge without a cycle', async () => {
      // A is blocked by B and C, both blocked by D: a diamond, not a cycle.
      const a = await inApollo('A')
      const b = await inApollo('B')
      const c = await inApollo('C')
      const d = await inApollo('D')
      await relations.addBlocker(by(alice), a, b)
      await relations.addBlocker(by(alice), a, c)
      await relations.addBlocker(by(alice), b, d)
      await relations.addBlocker(by(alice), c, d)
      await relations.addBlocker(by(alice), a, d)
      expect((await blockersOf(a)).toSorted()).toEqual([b, c, d].toSorted())
    })

    it('refuses a cycle that runs through another project (FR-014)', async () => {
      // Apollo's milestone M1 is blocked by Borealis's milestone M2; closing the loop from
      // Borealis is refused, though each relation crosses into another project only to a
      // milestone.
      await grantRole(x.db, bob, apollo, 'read-only')
      const m1 = await inApollo('M1', { milestone: FLOATING })
      const m2 = await inBorealis('M2', { milestone: FLOATING })
      await relations.addBlocker(by(alice), m1, m2)
      await refused(relations.addBlocker(by(bob), m2, m1), 'invalid', CYCLE)
      expect(await blockersOf(m2)).toEqual([])
    })

    it.each([
      ['fixed-date', FIXED],
      ['floating', FLOATING],
    ])(
      "lets a task be blocked by another project's %s milestone, held in the task's project (FR-015)",
      async (_, milestone) => {
        const m = await inBorealis('M', { milestone })
        const task = await inApollo('T')
        const before = (await x.db.select().from(tasks).where(eq(tasks.id, m)))[0]
        const answer = await relations.addBlocker(by(alice), task, m)
        expect(answer.blockedBy).toEqual([ref(m, borealis)])
        const [entry] = await entries(task)
        expect(entry).toMatchObject({
          projectId: apollo,
          action: 'task.blocker-added',
          details: { blockerId: m, blockerProjectId: borealis },
        })
        // Nothing changes on the milestone or in its project.
        expect((await x.db.select().from(tasks).where(eq(tasks.id, m)))[0]).toEqual(before)
        expect(await entries(m)).toHaveLength(0)
        expect((await relations.getRelations(by(bob), m)).blockedBy).toEqual([])
      },
    )

    it("refuses another project's milestone to someone who cannot read that project (FR-016)", async () => {
      const m = await make(hidden, { title: 'M', milestone: FIXED }, bob)
      const task = await inApollo('T')
      await refused(relations.addBlocker(by(alice), task, m), 'not-visible', NOT_VISIBLE_MESSAGE)
      expect(await blockersOf(task)).toEqual([])
      expect(await entries(task)).toHaveLength(0)
    })

    it("refuses another project's task that is not a milestone, once its project is readable", async () => {
      const other = await inBorealis('Other')
      const task = await inApollo('T')
      await refused(
        relations.addBlocker(by(alice), task, other),
        'invalid',
        "A task can be blocked by another project's milestone, not by its tasks",
      )
      // To someone who cannot read the project, it is not visible, milestone or not.
      const unseen = await make(hidden, { title: 'Unseen' }, bob)
      await refused(relations.addBlocker(by(alice), task, unseen), 'not-visible')
      expect(await blockersOf(task)).toEqual([])
    })

    it.each([MISSING, 'not-a-uuid', 7, null])('refuses a blocker %s as not found', async (id) => {
      const task = await inApollo('T')
      await refused(relations.addBlocker(by(alice), task, id), 'not-found', 'There is no such task')
      expect(await blockersOf(task)).toEqual([])
    })

    it('refuses the read-only role and a contributor as forbidden, and a stranger as not visible', async () => {
      const task = await inApollo('Task')
      const blocker = await inApollo('Blocker')
      await refused(relations.addBlocker(by(reader), task, blocker), 'forbidden')
      await refused(relations.addBlocker(by(contributor), task, blocker), 'forbidden')
      await refused(relations.addBlocker(by(stranger), task, blocker), 'not-visible')
      expect(await blockersOf(task)).toEqual([])
    })

    it('refuses before looking at the blocker, so a refusal tells nothing about it', async () => {
      const task = await inApollo('Task')
      // An unknown blocker is not reported as not found to someone who may not edit the plan.
      await refused(relations.addBlocker(by(reader), task, MISSING), 'forbidden')
      const error = await refused(relations.addBlocker(by(stranger), task, MISSING), 'not-visible')
      expect(error.message).toBe(NOT_VISIBLE_MESSAGE)
    })

    it('closes no cycle when two relations that would make one are saved at once', async () => {
      const a = await inApollo('A')
      const b = await inApollo('B')
      const results = await Promise.allSettled([
        relations.addBlocker(by(alice), a, b),
        relations.addBlocker(by(alice), b, a),
      ])
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const total = (await blockersOf(a)).length + (await blockersOf(b)).length
      expect(total).toBe(1)
    })
  })

  describe('removeBlocker', () => {
    it('makes a task no longer blocked by a task, and records it in the audit log', async () => {
      const task = await inApollo('Task')
      const blocker = await inApollo('Blocker')
      await relations.addBlocker(by(alice), task, blocker)
      const answer = await relations.removeBlocker(by(writer), task, blocker)
      expect(answer.blockedBy).toEqual([])
      expect(await blockersOf(task)).toEqual([])
      expect((await entries(task)).at(-1)).toMatchObject({
        actorAccountId: writer.id,
        projectId: apollo,
        action: 'task.blocker-removed',
        details: { blockerId: blocker },
      })
    })

    it("removes a dependency on another project's milestone without asking that project", async () => {
      const m = await make(hidden, { title: 'M', milestone: FIXED }, bob)
      await grantRole(x.db, alice, hidden, 'read-only')
      const task = await inApollo('T')
      await relations.addBlocker(by(alice), task, m)
      // alice can no longer read Hidden; the relation is still Apollo's, so she can remove it.
      await x.db.execute(
        sql`delete from project_members where project_id = ${hidden} and account_id = ${alice.id}`,
      )
      expect((await relations.removeBlocker(by(alice), task, m)).blockedBy).toEqual([])
    })

    it.each([MISSING, 'not-a-uuid'])(
      'refuses %s, which does not block the task, as not found',
      async (id) => {
        const task = await inApollo('Task')
        const other = await inApollo('Other')
        await relations.addBlocker(by(alice), task, other)
        await refused(
          relations.removeBlocker(by(alice), task, id),
          'not-found',
          'The task is not blocked by that task',
        )
        expect(await blockersOf(task)).toEqual([other])
      },
    )

    it('refuses the read-only role as forbidden, and a stranger as not visible', async () => {
      const task = await inApollo('Task')
      const blocker = await inApollo('Blocker')
      await relations.addBlocker(by(alice), task, blocker)
      await refused(relations.removeBlocker(by(reader), task, blocker), 'forbidden')
      await refused(relations.removeBlocker(by(stranger), task, blocker), 'not-visible')
      expect(await blockersOf(task)).toEqual([blocker])
    })
  })

  describe('the database', () => {
    it('refuses a task blocked by itself, and a task as its own parent', async () => {
      const task = await inApollo('Task')
      await expect(
        x.db.insert(taskBlockedBy).values({ taskId: task, blockerId: task }),
      ).rejects.toMatchObject({ cause: { constraint: 'task_blocked_by_not_self' } })
      await expect(
        x.db.update(tasks).set({ parentId: task }).where(eq(tasks.id, task)),
      ).rejects.toMatchObject({ cause: { constraint: 'tasks_not_own_parent' } })
    })

    it('refuses a relation to a task that does not exist', async () => {
      const task = await inApollo('Task')
      await expect(
        x.db.insert(taskBlockedBy).values({ taskId: task, blockerId: MISSING }),
      ).rejects.toMatchObject({ cause: { constraint: 'task_blocked_by_blocker_id_tasks_id_fk' } })
      await expect(
        x.db.update(tasks).set({ parentId: MISSING }).where(eq(tasks.id, task)),
      ).rejects.toMatchObject({ cause: { constraint: 'tasks_parent_id_tasks_id_fk' } })
    })
  })
})

describe('test cases through the REST API', () => {
  let x: TestDatabase
  let app: ReturnType<typeof buildApp>
  let alice: Seeded
  let bob: Seeded
  let apollo: string

  beforeEach(async () => {
    // A fresh test deployment for each test case: empty database, the first system admin root.
    // TC-267's global calendar (Saturday and Sunday off, no company holidays) is not yet held by
    // the tool (SC-008); none of its outcomes depends on it.
    x = await createTestDatabase()
    app = buildApp({}, { authenticators: [testAuthenticator], services: createServices(x.db) })
    await seedAccount(x.db, { username: 'root', systemAdmin: true })
    alice = await seedAccount(x.db, { username: 'alice' })
    bob = await seedAccount(x.db, { username: 'bob' })
    apollo = await seedProject(x.db, alice, 'Apollo')
    return async () => {
      await app.close()
      await x.drop()
    }
  })

  const createTask = async (who: Seeded, project: string, payload: TaskInput) => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/projects/${project}/tasks`,
      headers: as(who, 'rest-api'),
      payload,
    })
    expect(response.statusCode).toBe(201)
    return response.json<Task>()
  }
  const block = (who: Seeded, taskId: string, blockerId: string) =>
    app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/blocked-by`,
      headers: as(who, 'rest-api'),
      payload: { blockerId },
    })
  const setParent = (who: Seeded, taskId: string, parentId: string | null) =>
    app.inject({
      method: 'PUT',
      url: `/api/tasks/${taskId}/parent`,
      headers: as(who, 'rest-api'),
      payload: { parentId },
    })
  const relationsOf = async (who: Seeded, taskId: string) => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/tasks/${taskId}/relations`,
      headers: as(who, 'rest-api'),
    })
    expect(response.statusCode).toBe(200)
    return response.json<TaskRelations>()
  }
  const blockerIds = async (who: Seeded, taskId: string) =>
    (await relationsOf(who, taskId)).blockedBy.map((blocker) => blocker.id)

  describe('TC-022: a blocked-by relation that closes a cycle is rejected', () => {
    it('rejects C blocked by A, and leaves exactly A blocked by B and B blocked by C', async () => {
      const a = (await createTask(alice, apollo, { title: 'A' })).id
      const b = (await createTask(alice, apollo, { title: 'B' })).id
      const c = (await createTask(alice, apollo, { title: 'C' })).id
      expect((await block(alice, a, b)).statusCode).toBe(200)
      expect((await block(alice, b, c)).statusCode).toBe(200)

      const response = await block(alice, c, a)
      expect(response.statusCode).toBe(400)
      expect(response.json().message).toBe(CYCLE)

      expect(await blockerIds(alice, a)).toEqual([b])
      expect(await blockerIds(alice, b)).toEqual([c])
      // Negative: C is not blocked by A, and no other relation is added or removed.
      expect(await blockerIds(alice, c)).toEqual([])
      expect(await x.db.select().from(taskBlockedBy)).toHaveLength(2)
    })
  })

  describe("TC-023: a task can be blocked by another project's milestone", () => {
    it("records T blocked by M in Apollo, and leaves M and Borealis's plan unchanged", async () => {
      const borealis = await seedProject(x.db, bob, 'Borealis')
      await grantRole(x.db, alice, borealis, 'read-only')
      const m = await createTask(bob, borealis, {
        title: 'M',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })
      const t = (await createTask(alice, apollo, { title: 'T' })).id

      const response = await block(alice, t, m.id)
      expect(response.statusCode).toBe(200)

      const relations = await relationsOf(alice, t)
      expect(relations.blockedBy).toEqual([{ id: m.id, projectId: borealis }])
      // The relation is held in Apollo: it is T's, and T is Apollo's.
      const held = await x.db.execute<{ project_id: string }>(sql`
        select t.project_id from task_blocked_by r join tasks t on t.id = r.task_id
        where r.blocker_id = ${m.id}
      `)
      expect(held.rows).toEqual([{ project_id: apollo }])

      // Negative: M is unchanged, same date, same project, and no relation is recorded in
      // Borealis's plan.
      const after = await app.inject({
        method: 'GET',
        url: `/api/tasks/${m.id}`,
        headers: as(bob, 'rest-api'),
      })
      expect(after.json()).toEqual(m)
      expect(await relationsOf(bob, m.id)).toEqual({
        taskId: m.id,
        parent: null,
        subtasks: [],
        blockedBy: [],
      })
      const inBorealis = await x.db.execute(sql`
        select 1 from task_blocked_by r join tasks t on t.id = r.task_id
        where t.project_id = ${borealis}
      `)
      expect(inBorealis.rows).toEqual([])
      const borealisLog = await x.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.projectId, borealis))
      expect(borealisLog).toEqual([{ action: 'task.created' }])
    })
  })

  describe("TC-024: depending on an unreadable project's milestone is rejected", () => {
    it('rejects T blocked by M, and leaves T with no blocked-by relations', async () => {
      // alice has no role in Borealis, directly or through a group.
      const borealis = await seedProject(x.db, bob, 'Borealis')
      const m = await createTask(bob, borealis, {
        title: 'M',
        milestone: { variant: 'fixed-date', date: '2027-03-12' },
      })
      const t = (await createTask(alice, apollo, { title: 'T' })).id

      const response = await block(alice, t, m.id)
      expect(response.statusCode).toBe(403)
      // The response tells only that the project is not visible (FR-017), nothing about M.
      expect(response.json()).toEqual({
        statusCode: 403,
        error: 'Not Visible',
        message: NOT_VISIBLE_MESSAGE,
      })

      expect(await blockerIds(alice, t)).toEqual([])
      // Negative: no dependency on M is recorded in Apollo.
      expect(
        await x.db.select().from(taskBlockedBy).where(eq(taskBlockedBy.blockerId, m.id)),
      ).toEqual([])
    })
  })

  describe('TC-267: a milestone cannot be a subtask or a parent', () => {
    it('rejects Launch as a subtask of Build, and Build as a subtask of Launch', async () => {
      const build = (await createTask(alice, apollo, { title: 'Build' })).id
      const launch = (
        await createTask(alice, apollo, {
          title: 'Launch',
          milestone: { variant: 'fixed-date', date: '2027-03-12' },
        })
      ).id

      const launchUnderBuild = await setParent(alice, launch, build)
      expect(launchUnderBuild.statusCode).toBe(400)
      expect(launchUnderBuild.json().message).toBe(
        'A milestone cannot be a subtask of another task',
      )
      const buildUnderLaunch = await setParent(alice, build, launch)
      expect(buildUnderLaunch.statusCode).toBe(400)
      expect(buildUnderLaunch.json().message).toBe('A task cannot be a subtask of a milestone')

      for (const id of [build, launch]) {
        const relations = await relationsOf(alice, id)
        expect(relations.parent).toBeNull()
        expect(relations.subtasks).toEqual([])
      }
      // Negative: no parent-and-subtask relation between them is recorded, either way.
      const parents = await x.db
        .select({ parentId: tasks.parentId })
        .from(tasks)
        .where(eq(tasks.projectId, apollo))
      expect(parents).toEqual([{ parentId: null }, { parentId: null }])
    })
  })
})
